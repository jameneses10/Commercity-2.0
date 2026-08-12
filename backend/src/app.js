const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const env = require('./config/env');
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const storeRoutes = require('./routes/store.routes');
const categoryRoutes = require('./routes/category.routes');
const productRoutes = require('./routes/product.routes');
const cartRoutes = require('./routes/cart.routes');
const addressRoutes = require('./routes/address.routes');
const { orderRouter, sellerOrderRouter, adminOrderRouter } = require('./routes/order.routes');
const paymentRoutes = require('./routes/payment.routes');
const accountRoutes = require('./routes/account.routes');
const profileRoutes = require('./routes/profile.routes');
const profileSingleRoutes = require('./routes/profileSingle.routes');
const sellerStatsRoutes = require('./routes/sellerStats.routes');
const bankAccountRoutes = require('./routes/bankAccount.routes');
const { productReportRouter, adminProductReportRouter } = require('./routes/productReport.routes');
const { shipmentRouter, sellerShipmentRouter } = require('./routes/shipment.routes');
const { reviewRouter, adminReviewRouter } = require('./routes/review.routes');
const notificationRoutes = require('./routes/notification.routes');
const logRoutes = require('./routes/log.routes');
const followRoutes = require('./routes/follow.routes');
const chatRoutes = require('./routes/chat.routes');
const { userReportRouter, adminUserReportRouter } = require('./routes/userReport.routes');
const adminStatsRoutes = require('./routes/adminStats.routes');
const adminSearchRoutes = require('./routes/adminSearch.routes');
const favoriteRoutes = require('./routes/favorite.routes');
const returnRoutes = require('./routes/return.routes');
const sellerReturnRoutes = require('./routes/sellerReturn.routes');
const adminReturnRoutes = require('./routes/adminReturn.routes');
const adminAccountRoutes = require('./routes/adminAccount.routes');
const sellerWebRoutes = require('./routes/sellerWeb.routes');
const adminWebRoutes = require('./routes/adminWeb.routes');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');

const app = express();

app.set('trust proxy', 'loopback');

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads'), { fallthrough: false, maxAge: '1d' }));

if (env.nodeEnv !== 'test') {
  app.use(morgan('dev'));
}

app.use('/api/v1', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/stores', storeRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/products', productReportRouter);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/orders', orderRouter);
app.use('/api/v1/seller', sellerOrderRouter);
app.use('/api/v1/admin', adminOrderRouter);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/account', accountRoutes);
app.use('/api/v1/profiles', profileRoutes);
app.use('/api/v1/profile', profileSingleRoutes);
app.use('/api/v1/profiles', followRoutes);
app.use('/api/v1/chat', chatRoutes);
app.use('/api/v1/users', userReportRouter);
app.use('/api/v1/seller', sellerStatsRoutes);
app.use('/api/v1/seller', bankAccountRoutes);
app.use('/api/v1/admin', adminProductReportRouter);
app.use('/api/v1/admin', adminUserReportRouter);
app.use('/api/v1/admin', adminStatsRoutes);
app.use('/api/v1/admin', adminSearchRoutes);
app.use('/api/v1/favorites', favoriteRoutes);
app.use('/api/v1/returns', returnRoutes);
app.use('/api/v1/seller', sellerReturnRoutes);
app.use('/api/v1/admin', adminReturnRoutes);
app.use('/api/v1/admin', adminAccountRoutes);
app.use('/api/v1/seller', sellerWebRoutes);
app.use('/api/v1/admin', adminWebRoutes);
app.use('/api/v1/shipments', shipmentRouter);
app.use('/api/v1/seller', sellerShipmentRouter);
app.use('/api/v1/reviews', reviewRouter);
app.use('/api/v1/admin/reviews', adminReviewRouter);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/admin/logs', logRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
