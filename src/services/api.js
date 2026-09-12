/**
 * Client API — toutes les écritu​res passent par cette couche.
 * Elle récupère le token Firebase courant et appelle les Netlify Functions.
 */
import { auth } from '../firebase';

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
    return data;
}
