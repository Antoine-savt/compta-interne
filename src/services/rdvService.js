/**
 * rdvService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Service de gestion des Rendez-vous (RDV) dans Firestore.
 * Collection : 'rendezvous'
 * Synchronisation automatique avec la fiche client (prochainRdvDate, etc.)
 * Cache mémoire et localStorage pour un affichage instantané (0ms).
 */
import {
    collection, doc, getDocs, getDoc, addDoc, updateDoc,
    deleteDoc, query, orderBy, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { getCached, setCached } from './dataCache';

const CACHE_KEY = 'crm_rendezvous_list';
const LOCAL_STORAGE_KEY = 'crm_rendezvous_persisted';

/**
 * Récupère la liste de tous les RDV
 */
export async function getRendezVousList() {
    const cached = getCached(CACHE_KEY);
    if (cached && Array.isArray(cached)) return cached;

    // Fallback localStorage
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
        const q = query(collection(db, 'rendezvous'), orderBy('date', 'asc'));
        const snap = await getDocs(q);
        const list = snap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
        }));

        setCached(CACHE_KEY, list);
        try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(list)); } catch {}
        return list;
    } catch (err) {
        console.error('Erreur récupération rendezvous Firestore:', err);
        try {
            const local = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (local) return JSON.parse(local);
        } catch {}
        return [];
    }
}

export const getAllRendezVous = getRendezVousList;

/**
 * Crée un nouveau rendez-vous
 * @param {Object} rdvData
 */
export async function createRendezVous(rdvData) {
    const list = (await getRendezVousList()) || [];

    const newRdv = {
        clientId: rdvData.clientId || '',
        clientNom: rdvData.clientNom || 'Sans nom',
        clientContact: rdvData.clientContact || '',
        clientTelephone: rdvData.clientTelephone || '',
        clientEmail: rdvData.clientEmail || '',
        quiGere: rdvData.quiGere || 'Antoine',
        date: rdvData.date, // 'YYYY-MM-DD'
        heureDebut: rdvData.heureDebut || '09:00', // 'HH:mm'
        heureFin: rdvData.heureFin || calculateEndTime(rdvData.heureDebut || '09:00', rdvData.dureeMinutes || 30),
        dureeMinutes: Number(rdvData.dureeMinutes) || 30,
        type: rdvData.type || 'visio', // 'telephone' | 'visio' | 'presentiel'
        notes: rdvData.notes || '',
        lienVisio: rdvData.lienVisio || '',
        lieu: rdvData.lieu || '',
        statut: rdvData.statut || 'planifie', // 'planifie' | 'termine' | 'annule'
        notificationEmail: rdvData.notificationEmail || '',
        notificationDelaiMinutes: Number(rdvData.notificationDelaiMinutes) || 15,
        notificationSent: false,
        inAppNotified: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    };

    let createdId = `rdv_${Date.now()}`;

    try {
        const docRef = await addDoc(collection(db, 'rendezvous'), newRdv);
        createdId = docRef.id;
    } catch (err) {
        console.warn('Erreur Firestore création RDV (sauvegardé en local):', err);
    }

    const savedRdv = { ...newRdv, id: createdId };
    const updatedList = [...list, savedRdv];
    setCached(CACHE_KEY, updatedList);
    try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedList)); } catch {}

    // Synchronisation avec la fiche client
    if (newRdv.clientId) {
        syncClientProchainRdv(newRdv.clientId, updatedList);
    }

    return savedRdv;
}

/**
 * Met à jour un rendez-vous existant
 * @param {string} rdvId
 * @param {Object} updates
 */
export async function updateRendezVous(rdvId, updates) {
    const list = (await getRendezVousList()) || [];

    if (updates.heureDebut || updates.dureeMinutes) {
        const hDebut = updates.heureDebut || list.find((r) => r.id === rdvId)?.heureDebut || '09:00';
        const duree = Number(updates.dureeMinutes || list.find((r) => r.id === rdvId)?.dureeMinutes || 30);
        updates.heureFin = calculateEndTime(hDebut, duree);
    }

    const updatedList = list.map((r) => (r.id === rdvId ? { ...r, ...updates, updatedAt: new Date().toISOString() } : r));
    setCached(CACHE_KEY, updatedList);
    try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedList)); } catch {}

    try {
        await updateDoc(doc(db, 'rendezvous', rdvId), {
            ...updates,
            updatedAt: serverTimestamp(),
        });
    } catch (err) {
        console.warn(`Erreur Firestore mise à jour RDV ${rdvId}:`, err);
    }

    const targetRdv = updatedList.find((r) => r.id === rdvId);
    if (targetRdv?.clientId) {
        syncClientProchainRdv(targetRdv.clientId, updatedList);
    }

    return targetRdv;
}

/**
 * Supprime un rendez-vous
 * @param {string} rdvId
 */
export async function deleteRendezVous(rdvId) {
    const list = (await getRendezVousList()) || [];
    const targetRdv = list.find((r) => r.id === rdvId);

    const updatedList = list.filter((r) => r.id !== rdvId);
    setCached(CACHE_KEY, updatedList);
    try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(updatedList)); } catch {}

    try {
        await deleteDoc(doc(db, 'rendezvous', rdvId));
    } catch (err) {
        console.warn(`Erreur Firestore suppression RDV ${rdvId}:`, err);
    }

    if (targetRdv?.clientId) {
        syncClientProchainRdv(targetRdv.clientId, updatedList);
    }

    return true;
}

/**
 * Synchronise le "prochain RDV" sur le document du client
 */
async function syncClientProchainRdv(clientId, allRdvs) {
    if (!clientId) return;
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        // Trouver le prochain RDV planifié à venir
        const clientUpcomingRdvs = allRdvs
            .filter((r) => r.clientId === clientId && r.statut === 'planifie' && r.date >= todayStr)
            .sort((a, b) => (a.date + a.heureDebut).localeCompare(b.date + b.heureDebut));

        const nextRdv = clientUpcomingRdvs[0] || null;

        const payload = nextRdv
            ? {
                prochainRdvDate: nextRdv.date,
                prochainRdvHeure: nextRdv.heureDebut,
                prochainRdvFormat: nextRdv.type,
                prochainRdvObjet: nextRdv.notes || `Rendez-vous ${nextRdv.type}`,
                prochainRdvLien: nextRdv.lienVisio || '',
                updatedAt: serverTimestamp(),
            }
            : {
                prochainRdvDate: null,
                prochainRdvHeure: null,
                prochainRdvFormat: null,
                prochainRdvObjet: null,
                prochainRdvLien: null,
                updatedAt: serverTimestamp(),
            };

        await updateDoc(doc(db, 'clients', clientId), payload);

        // Mettre à jour le cache client
        const cachedClients = getCached('clients');
        if (Array.isArray(cachedClients)) {
            setCached('clients', cachedClients.map((c) => (c.id === clientId ? { ...c, ...payload } : c)));
        }
    } catch (err) {
        console.warn(`Erreur synchronisation prochain RDV client ${clientId}:`, err);
    }
}

/**
 * Calcule l'heure de fin HH:mm à partir de l'heure de début et de la durée en minutes
 */
export function calculateEndTime(startHHmm, durationMinutes) {
    if (!startHHmm) return '09:30';
    const [h, m] = startHHmm.split(':').map(Number);
    const totalMin = (h || 0) * 60 + (m || 0) + Number(durationMinutes);
    const endH = Math.floor(totalMin / 60) % 24;
    const endM = totalMin % 60;
    return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}
