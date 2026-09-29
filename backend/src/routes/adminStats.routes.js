const express=require('express'); const c=require('../controllers/adminStats.controller'); const authRequired=require('../middlewares/authRequired'); const requireRole=require('../middlewares/requireRole');
const router=express.Router();
router.get('/dashboard-stats',authRequired,requireRole('administrador'),c.dashboardStats);
router.get('/reports',authRequired,requireRole('administrador'),c.reports);
router.get('/users',authRequired,requireRole('administrador'),c.listUsers);
router.patch('/users/:id/status',authRequired,requireRole('administrador'),c.updateUserStatus);
module.exports=router;
