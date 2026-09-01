/*
 * modules/projects/controllers/public-projects.controller.js
 * ============================================================================
 *
 * The one route on this module a visitor reaches. It is a deliberately
 * narrower projection than the admin list: no due_date, no created_at, no
 * updated_at, and only rows an administrator has marked visible.
 */
const express = require('express');
const { supabase } = require('../../../core/database/supabase');
const { isSectionVisible } = require('../services/project-visibility.service');
const { errorTag } = require('../../../shared/error-tag');

/** @returns {import('express').Router} */
function publicProjectsController() {
    const router = express.Router();

    // Public, read-only version for the site-wide carousel (no admin key required).
    // Only exposes display fields — no due_date/created_at/updated_at — and only
    // projects the admin has marked visible.
    router.get('/api/projects/public', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('upcoming_projects')
                .select('id, project_category_title, project_name, project_description')
                .eq('is_visible', true)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const baseUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/project-images/`;

            const projects = (data || []).map(project => ({
                id: project.id,
                category: project.project_category_title,
                title: project.project_name,
                description: project.project_description,
                image_url: `${baseUrl}${project.id}-cover`
            }));

            res.status(200).json({
                section_visible: await isSectionVisible(),
                projects
            });
        } catch (error) {
            console.error("Fetch Public Projects Error:", errorTag(error));
            res.status(500).json({ error: "Failed to fetch projects." });
        }
    });


    return router;
}

module.exports = { publicProjectsController };
