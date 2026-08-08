const fs = require('fs');
const path = require('path');
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password');

async function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function seedAdmin() {
  const adminName = process.env.ADMIN_NAME || 'Administrador CommerCity';
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@commercity.local';
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || !adminPassword.trim()) {
    throw new Error('Falta ADMIN_PASSWORD para crear o actualizar el administrador.');
  }

  const [[adminRole]] = await pool.query(
    'SELECT id FROM roles WHERE nombre = ? LIMIT 1',
    ['administrador']
  );

  if (!adminRole) {
    throw new Error('No existe el rol administrador. Ejecute primero npm run db:migrate y el seed de roles.');
  }

  const passwordHash = await hashPassword(adminPassword);

  await pool.query(
    `INSERT INTO usuarios (rol_id, nombre, correo, password_hash, estado)
     VALUES (?, ?, ?, ?, 'activo')
     ON DUPLICATE KEY UPDATE
       nombre = VALUES(nombre),
       rol_id = VALUES(rol_id),
       estado = 'activo'`,
    [adminRole.id, adminName, adminEmail, passwordHash]
  );

  console.log(`Seed administrador listo: ${adminEmail}`);
}

async function seed() {
  const seedersDir = path.join(__dirname, '..', 'database', 'seeders');
  const files = fs
    .readdirSync(seedersDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(seedersDir, file);
    await runSqlFile(filePath);
    console.log(`Seed ejecutado: ${file}`);
  }

  await seedAdmin();
  await pool.end();
}

seed().catch(async (error) => {
  console.error('Error ejecutando seeds:', error.message);
  await pool.end();
  process.exit(1);
});
