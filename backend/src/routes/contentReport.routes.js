const express=require('express');
const c=require('../controllers/contentReport.controller');
const authRequired=require('../middlewares/authRequired');
const requireRole=require('../middlewares/requireRole');
const {createContentReportValidator,resolveContentReportValidator}=require('../validators/contentReport.validators');

const storeReportRouter=express.Router();
storeReportRouter.post('/:id/report',authRequired,createContentReportValidator,c.createFor('stores'));

const reviewReportRouter=express.Router();
reviewReportRouter.post('/:id/report',authRequired,createContentReportValidator,c.createFor('reviews'));

const adminContentReportRouter=express.Router();
adminContentReportRouter.use(authRequired,requireRole('administrador'));
adminContentReportRouter.get('/reports/stores',c.listFor('stores'));
adminContentReportRouter.patch('/reports/stores/:id',resolveContentReportValidator,c.resolveFor('stores'));
adminContentReportRouter.get('/reports/reviews',c.listFor('reviews'));
adminContentReportRouter.patch('/reports/reviews/:id',resolveContentReportValidator,c.resolveFor('reviews'));
adminContentReportRouter.get('/reports/messages',c.listFor('messages'));
adminContentReportRouter.patch('/reports/messages/:id',resolveContentReportValidator,c.resolveFor('messages'));

module.exports={storeReportRouter,reviewReportRouter,adminContentReportRouter};
