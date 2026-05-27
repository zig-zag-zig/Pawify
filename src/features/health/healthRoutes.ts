import express from 'express';
import { publicHandler } from '../../common/http/handlers.js';

export const healthRoutes = express.Router();

healthRoutes.get('/keep-alive', publicHandler('/keep-alive', (_req, res) => {
    res.status(200).send('Server is alive.');
}));
