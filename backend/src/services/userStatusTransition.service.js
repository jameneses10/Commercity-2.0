const {
  findUserById,
  updateUserStatusConditional,
  incrementTokenVersion
} = require('../models/user.model');

const ALLOWED_STATUSES = new Set(['activo', 'inactivo', 'baneado']);

function transitionError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function applyUserStatusTransition({ conn, userId, requestedEstado }) {
  if (!conn || typeof conn.query !== 'function') {
    throw transitionError('USER_STATUS_CONNECTION_REQUIRED');
  }
  if (!ALLOWED_STATUSES.has(requestedEstado)) {
    throw transitionError('USER_STATUS_INVALID_TARGET');
  }

  const user = await findUserById(userId, conn);
  if (!user) {
    throw transitionError('USER_STATUS_TARGET_NOT_FOUND');
  }
  if (!ALLOWED_STATUSES.has(user.estado)) {
    throw transitionError('USER_STATUS_UNSUPPORTED_CURRENT');
  }

  const previousEstado = user.estado;
  if (previousEstado === requestedEstado) {
    return {
      previousEstado,
      currentEstado: previousEstado,
      changed: false,
      revoked: false
    };
  }

  const statusAffected = await updateUserStatusConditional(
    userId,
    requestedEstado,
    previousEstado,
    conn
  );
  if (statusAffected !== 1) {
    throw transitionError('USER_STATUS_CONFLICT');
  }

  const isRestrictiveTarget = requestedEstado === 'inactivo' || requestedEstado === 'baneado';
  if (isRestrictiveTarget) {
    const versionAffected = await incrementTokenVersion(userId, conn);
    if (versionAffected !== 1) {
      throw transitionError('USER_TOKEN_VERSION_UPDATE_FAILED');
    }
  }

  return {
    previousEstado,
    currentEstado: requestedEstado,
    changed: true,
    revoked: isRestrictiveTarget
  };
}

module.exports = { applyUserStatusTransition };
