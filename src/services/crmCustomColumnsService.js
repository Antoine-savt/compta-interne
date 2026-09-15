/**
 * crmCustomColumnsService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gestion des colonnes personnalisées de statuts (menus déroulants)
 * Stockage dans Firestore : doc(db, 'settings', 'crm_columns')
 * Avec cache mémoire pour un rendu instantané.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getCached, setCached } from './dataCache';

export const COLOR_PALETTE = [
    { id: 'gray', label: 'Gris', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
    { id: 'blue', label: 'Bleu', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
    { id: 'amber', label: 'Ambre', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
    { id: 'emerald', label: 'Vert', color: '#047857', bg: '#d1fae5', border: '#6ee7b7' },
    { id: 'purple', label: 'Violet', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
    { id: 'rose', label: 'Rouge', color: '#be123c', bg: '#ffe4e6', border: '#fecdd3' },
    { id: 'cyan', label: 'Cyan', color: '#0e7490', bg: '#ecfeff', border: '#a5f3fc' },
    { id: 'indigo', label: 'Indigo', color: '#4338ca', bg: '#eef2ff', border: '#c7d2fe' },
];

export const DEFAULT_CRM_COLUMNS = [
    {
        id: 'col_statut_appel',
        label: 'Statut appel',
        type: 'select',
        options: [
            { id: 'a_rappeler', label: 'À rappeler', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
            { id: 'pas_repondu', label: 'Pas répondu', color: '#475569', bg: '#f1f5f9', border: '#cbd5e1' },
            { id: 'pas_interesse', label: 'Pas intéressé', color: '#be123c', bg: '#ffe4e6', border: '#fecdd3' },
            { id: 'rdv_pris', label: 'RDV pris', color: '#047857', bg: '#d1fae5', border: '#6ee7b7' },
        ],
    },
    {
        id: 'col_statut_email',
        label: 'Statut email',
        type: 'select',
        options: [
            { id: 'a_envoyer', label: 'À envoyer', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
            { id: 'envoye', label: 'Envoyé', color: '#6d28d9', bg: '#f5f3ff', border: '#ddd6fe' },
            { id: 'relance_1', label: 'Relance 1', color: '#b45309', bg: '#fef3c7', border: '#fcd34d' },
            { id: 'reponse_recue', label: 'Réponse reçue', color: '#047857', bg: '#d1fae5', border: '#6ee7b7' },
        ],
    },
];

const CACHE_KEY = 'crm_custom_columns';
const LOCAL_STORAGE_KEY = 'crm_custom_columns_local';

/**
 * Récupère les colonnes personnalisées depuis Firestore (avec fallback cache, localStorage et defaults)
 */
export async function getCustomColumns() {
    const cached = getCached(CACHE_KEY);
    if (cached && Array.isArray(cached)) return cached;

    try {
        const local = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (local) {
            const parsed = JSON.parse(local);
            if (Array.isArray(parsed) && parsed.length > 0) {
                setCached(CACHE_KEY, parsed);
                return parsed;
            }
        }
    } catch {}

    try {
        const snap = await getDoc(doc(db, 'settings', 'crm_columns'));
        if (snap.exists() && Array.isArray(snap.data().columns)) {
            const cols = snap.data().columns;
            setCached(CACHE_KEY, cols);
            try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cols)); } catch {}
            return cols;
        }

        // Si le doc n'existe pas du tout dans Firestore, on crée avec les valeurs initiales
        if (!snap.exists()) {
            await setDoc(doc(db, 'settings', 'crm_columns'), {
                columns: DEFAULT_CRM_COLUMNS,
                updatedAt: serverTimestamp(),
            });
            setCached(CACHE_KEY, DEFAULT_CRM_COLUMNS);
            try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_CRM_COLUMNS)); } catch {}
            return DEFAULT_CRM_COLUMNS;
        }

        setCached(CACHE_KEY, []);
        return [];
    } catch (err) {
        console.error('Erreur récupération crm_columns Firestore:', err);
        try {
            const local = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (local) {
                const parsed = JSON.parse(local);
                if (Array.isArray(parsed)) return parsed;
            }
        } catch {}
        return DEFAULT_CRM_COLUMNS;
    }
}

/**
 * Sauvegarde la configuration des colonnes dans Firestore, cache mémoire et localStorage
 */
export async function saveCustomColumns(columns) {
    const toSave = Array.isArray(columns) ? columns : [];
    setCached(CACHE_KEY, toSave);
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(toSave));
    } catch {}

    try {
        await setDoc(doc(db, 'settings', 'crm_columns'), {
            columns: toSave,
            updatedAt: serverTimestamp(),
        });
        return true;
    } catch (err) {
        console.warn('Erreur synchronisation crm_columns Firestore (conservé en local):', err);
        return false;
    }
}

