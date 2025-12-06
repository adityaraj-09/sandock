import { Router, Response } from 'express';
import { listTemplates, getTemplate, getTemplatesByLanguage } from '../config/templates.js';

const router = Router();

router.get('/', (_req, res: Response): void => {
  const templates = listTemplates();
  res.json({
    success: true,
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      language: t.language,
      packages: t.packages,
      ports: t.ports
    }))
  });
});

router.get('/language/:language', (req, res: Response): void => {
  const { language } = req.params;
  const templates = getTemplatesByLanguage(language);

  res.json({
    success: true,
    language,
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      packages: t.packages,
      ports: t.ports
    }))
  });
});

router.get('/:id', (req, res: Response): void => {
  const { id } = req.params;
  const template = getTemplate(id);

  if (!template) {
    res.status(404).json({
      success: false,
      error: 'Template not found'
    });
    return;
  }

  res.json({
    success: true,
    template
  });
});

export default router;
