const express = require('express');
const authController = require('../controllers/auth.controller');
const authRequired = require('../middlewares/authRequired');
const requireRole = require('../middlewares/requireRole');
const { registerValidator, loginValidator, forgotPasswordValidator, resetPasswordValidator, changePasswordValidator, reactivateValidator } = require('../validators/auth.validators');

const router = express.Router();
router.post('/register', registerValidator, authController.register);
router.post('/login', loginValidator, authController.login);
router.post('/reactivate', reactivateValidator, authController.reactivate);
router.post('/forgot-password', forgotPasswordValidator, authController.forgot);
router.post('/reset-password', resetPasswordValidator, authController.reset);
router.post('/change-password', authRequired, changePasswordValidator, authController.change);
router.get('/me', authRequired, authController.me);
router.get('/admin-test', authRequired, requireRole('administrador'), authController.adminTest);
module.exports = router;
