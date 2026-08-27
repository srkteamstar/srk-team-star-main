/*
 * modules/projects/projects.module.js — the module registration file
 * ============================================================================
 *
 * WHAT THIS MODULE OWNS
 *   the upcoming_projects table, the site_settings row that hides the whole
 *   section, and the project-images storage bucket
 *
 *   GET    /api/projects/public                           anonymous
 *
 * One cover image per row, stored as <row id>-cover in a public bucket — the
 * same convention modules/categories uses.
 */
const express = require('express');
const { publicProjectsController } = require('./controllers/public-projects.controller');

/** @returns {import('express').Router} */
function projectsModule() {
    const router = express.Router();
    router.use(publicProjectsController());
    return router;
}

module.exports = { projectsModule };
