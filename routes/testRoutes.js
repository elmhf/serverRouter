import express from 'express';
import { renderEmailTemplate } from '../utils/templateRenderer.js';

const router = express.Router();

router.get('/email/:templateName', (req, res) => {
    const { templateName } = req.params;

    // Dummy data for testing
    const data = {
        code: '123456',
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        ...req.query // Allow overriding via query params
    };

    const html = renderEmailTemplate({
        templateName,
        ...data
    });

    if (!html) {
        return res.status(404).send('Template not found');
    }

    res.send(html);
});

export default router;
