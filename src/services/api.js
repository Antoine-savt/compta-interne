/**
 * Client API — toutes les écritu​res passent par cette couche.
 * Elle récupère le token Firebase courant et appelle les Netlify Functions.
 */
import { auth } from '../firebase';
import { invalidateEcrituresCache } from './comptaService';
import { invalidateCache } from './dataCache';

async function getToken() {
    const user = auth.currentUser;
    if (!user) throw new Error('Non authentifié');
    return user.getIdToken();
}

const BASE = '/api'; // redirigé vers /.netlify/functions/ par netlify.toml

/**
 * Écrire une écriture comptable via la fonction garde-fou.
 * @param {Object} ecritureInput
 * @returns {{ ok: boolean, ecritureId: string }}
 */
export async function ecrireEcriture(ecritureInput) {
    const token = await getToken();
    const res = await fetch(`${BASE}/ecrireEcriture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(ecritureInput),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Erreur lors de l\'écriture comptable');
    // Invalider les caches pour refléter immédiatement les nouveaux chiffres
    invalidateEcrituresCache();
    invalidateCache('overview_ecritures');
    return data;
}

/**
 * Corriger une écriture par contre-passation.
 * @param {string} ecritureId
 * @param {string} motif
 * @returns {{ ok: boolean, annulationId: string }}
 */
export async function contrepasser(ecritureId, motif) {
    const token = await getToken();
    const res = await fetch(`${BASE}/contrepasser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ecritureId, motif }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Erreur lors de la contre-passation');
    invalidateEcrituresCache();
    invalidateCache('overview_ecritures');
    return data;
}

async function appelerFonction(nom, payload, messageErreur) {
    const token = await getToken();
    const res = await fetch(`${BASE}/${nom}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? messageErreur);
    invalidateEcrituresCache();
    invalidateCache('overview_ecritures');
    return data;
}

/**
 * Modifier une écriture : mise à jour directe en brouillard, contre-passation + nouvelle
 * écriture si elle est validée. Toujours utiliser l'`ecritureId` retourné (il peut changer).
 * @returns {{ ok: boolean, ecritureId: string, remplacee: boolean, date: string }}
 */
export function modifierEcriture(ecritureId, ecriture, motif) {
    return appelerFonction('modifierEcriture', { ecritureId, ecriture, motif }, 'Erreur lors de la modification de l\'écriture');
}

/**
 * Annuler l'effet d'une écriture (brouillard : statut annulée ; validée : contre-passation).
 * @returns {{ ok: boolean, mode: 'brouillard' | 'contrepassation' | 'deja_annulee' }}
 */
export function annulerEcriture(ecritureId, motif) {
    return appelerFonction('annulerEcriture', { ecritureId, motif }, 'Erreur lors de l\'annulation de l\'écriture');
}

/** Valider (figer et numéroter) toutes les écritures jusqu'à `dateVerrou` incluse. */
export function validerPeriode(dateVerrou) {
    return appelerFonction('validerPeriode', { dateVerrou }, 'Erreur lors de la validation de la période');
}
