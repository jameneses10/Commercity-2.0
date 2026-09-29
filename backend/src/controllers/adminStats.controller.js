const service=require('../services/adminStats.service'); const {successResponse}=require('../utils/response');
async function dashboardStats(req,res,next){try{res.json(successResponse('Estadísticas administrativas obtenidas correctamente.',{stats:await service.dashboardStats()}))}catch(e){next(e)}}
async function reports(req,res,next){try{res.json(successResponse('Reportes administrativos obtenidos correctamente.',await service.reports(req.query)))}catch(e){next(e)}}
async function listUsers(req,res,next){try{res.json(successResponse('Usuarios obtenidos correctamente.',await service.listUsers(req.query)))}catch(e){next(e)}}
async function updateUserStatus(req,res,next){try{res.json(successResponse('Estado de usuario actualizado correctamente.',{user:await service.updateUserStatus(req.user,req.params.id,req.body.estado,req.ip)}))}catch(e){next(e)}}
module.exports={dashboardStats,reports,listUsers,updateUserStatus};
