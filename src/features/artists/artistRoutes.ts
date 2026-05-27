import express from 'express';
import {
    followArtistHandler,
    getArtistDetailsHandler,
    getFollowingHandler,
    searchArtistsHandler,
    unfollowArtistHandler,
    unfollowArtistsHandler,
} from './handlers/artistHandlers.js';

export const artistRoutes = express.Router();

artistRoutes.get('/getFollowing', getFollowingHandler);
artistRoutes.post('/getArtistDetails', getArtistDetailsHandler);
artistRoutes.post('/searchArtists', searchArtistsHandler);
artistRoutes.post('/followArtist', followArtistHandler);
artistRoutes.post('/unfollowArtist', unfollowArtistHandler);
artistRoutes.post('/unfollowArtists', unfollowArtistsHandler);
