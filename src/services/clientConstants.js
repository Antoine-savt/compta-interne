/**
 * clientConstants.js — Constantes partagées pour la gestion des clients et sites
 * AUCUN EMOJI.
 */

export const SITE_STATUTS = [
    { id: 'en_ligne', label: 'En ligne', cls: 'status-tag--online', color: '#16a34a', bg: '#f0fdf4' },
    { id: 'en_dev', label: 'En développement', cls: 'status-tag--dev', color: '#2563eb', bg: '#eff6ff' },
    { id: 'en_recette', label: 'En recette', cls: 'status-tag--recette', color: '#7c3aed', bg: '#f5f3ff' },
    { id: 'en_refonte', label: 'En refonte', cls: 'status-tag--refonte', color: '#d97706', bg: '#fffbeb' },
    { id: 'maintenance', label: 'Maintenance', cls: 'status-tag--maint', color: '#0891b2', bg: '#ecfeff' },
    { id: 'hors_ligne', label: 'Hors ligne', cls: 'status-tag--offline', color: '#6b7280', bg: '#f9fafb' },
];

export function getStatutClient(id) {
    return SITE_STATUTS.find((s) => s.id === id) || SITE_STATUTS[0];
}
