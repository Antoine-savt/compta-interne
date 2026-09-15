/**
 * rdvAvailabilityService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Moteur de calcul des disponibilités et prévention des conflits de rendez-vous.
 * - Plannings récurrents par personne (lundi au dimanche)
 * - Exceptions ponctuelles par date (jours off, horaires spéciaux)
 * - Détection automatique des conflits pour ne JAMAIS avoir deux RDV en même temps
 * - Génération des créneaux horaires avec statut (Disponible, Conflit, Hors créneau)
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { getCached, setCached } from './dataCache';

const CACHE_KEY = 'crm_disponibilites_settings';
const LOCAL_STORAGE_KEY = 'crm_disponibilites_persisted';

// Configuration de base par défaut pour un gestionnaire
export const DEFAULT_WEEK_SCHEDULE = {
    1: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], // Lundi
    2: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], // Mardi
    3: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], // Mercredi
    4: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], // Jeudi
    5: [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], // Vendredi
    6: [], // Samedi (fermé)
    0: [], // Dimanche (fermé)
};

export const DEFAULT_DISPONIBILITES = {
    Antoine: {
        defaultDuration: 30,
        defaultEmail: 'antoine@wheeloh.fr',
        defaultReminderMinutes: 15,
        recurring: { ...DEFAULT_WEEK_SCHEDULE },
        exceptions: [],
    },
    Théophile: {
        defaultDuration: 30,
        defaultEmail: 'theophile@wheeloh.fr',
        defaultReminderMinutes: 15,
        recurring: { ...DEFAULT_WEEK_SCHEDULE },
        exceptions: [],
    },
};

/**
 * Récupère les paramètres complets de disponibilités de l'équipe
 */
export async function getDisponibilitesSettings() {
    const cached = getCached(CACHE_KEY);
    if (cached) return cached;

    try {
        const local = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (local) {
            const parsed = JSON.parse(local);
            setCached(CACHE_KEY, parsed);
            return parsed;
        }
    } catch {}

    try {
        const snap = await getDoc(doc(db, 'settings', 'crm_disponibilites'));
        if (snap.exists()) {
            const data = snap.data();
            const result = data.users || DEFAULT_DISPONIBILITES;
            setCached(CACHE_KEY, result);
            try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(result)); } catch {}
            return result;
        }

        // Création initiale
        await setDoc(doc(db, 'settings', 'crm_disponibilites'), {
            users: DEFAULT_DISPONIBILITES,
            updatedAt: serverTimestamp(),
        });
        setCached(CACHE_KEY, DEFAULT_DISPONIBILITES);
        try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(DEFAULT_DISPONIBILITES)); } catch {}
        return DEFAULT_DISPONIBILITES;
    } catch (err) {
        console.warn('Erreur Firestore getDisponibilitesSettings, utilisation fallback local:', err);
        return DEFAULT_DISPONIBILITES;
    }
}

/**
 * Sauvegarde les disponibilités d'une personne
 */
export async function savePersonDisponibilites(personName, personConfig) {
    const all = { ...(await getDisponibilitesSettings()) };
    all[personName] = personConfig;

    setCached(CACHE_KEY, all);
    try { localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all)); } catch {}

    try {
        await setDoc(doc(db, 'settings', 'crm_disponibilites'), {
            users: all,
            updatedAt: serverTimestamp(),
        });
        return true;
    } catch (err) {
        console.warn('Erreur Firestore savePersonDisponibilites (gardé en local):', err);
        return false;
    }
}

/**
 * Convertit une heure HH:mm en minutes depuis minuit (ex: "09:30" => 570)
 */
export function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/**
 * Convertit des minutes depuis minuit en heure HH:mm
 */
export function minutesToTime(totalMinutes) {
    const h = Math.floor(totalMinutes / 60) % 24;
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Vérifie si deux plages horaires se chevauchent
 */
export function doIntervalsOverlap(startA, endA, startB, endB) {
    const sA = timeToMinutes(startA);
    const eA = timeToMinutes(endA);
    const sB = timeToMinutes(startB);
    const eB = timeToMinutes(endB);
    return Math.max(sA, sB) < Math.min(eA, eB);
}

/**
 * Récupère les plages d'ouverture effectives pour une personne et une date donnée
 */
export function getEffectiveWorkingRanges(personConfig, dateStr) {
    if (!personConfig) return DEFAULT_WEEK_SCHEDULE[1];

    // 1. Vérifier si la date exacte est dans les exceptions
    const exception = (personConfig.exceptions || []).find((ex) => ex.date === dateStr);
    if (exception) {
        if (exception.off) return []; // Journée off / fermée
        if (Array.isArray(exception.ranges) && exception.ranges.length > 0) {
            return exception.ranges;
        }
    }

    // 2. Sinon, prendre le planning récurrent selon le jour de la semaine
    const d = new Date(dateStr + 'T00:00:00');
    const dayOfWeek = d.getDay(); // 0 = Dimanche, 1 = Lundi ...
    const recurring = personConfig.recurring || DEFAULT_WEEK_SCHEDULE;
    return recurring[dayOfWeek] || [];
}

/**
 * Génère tous les créneaux de la journée (ex: de 08:00 à 20:00 toutes les stepMinutes)
 * avec leur statut d'accessibilité (disponible, conflit_rdv, hors_dispo).
 * 
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} personName - 'Antoine', 'Théophile', etc.
 * @param {number} durationMinutes - ex: 30
 * @param {Array} allRdvs - Liste de tous les RDV de la base
 * @param {Object} personConfig - Configuration de disponibilités de la personne
 * @param {string} [ignoreRdvId] - Id du RDV en cours d'édition à exclure du calcul de conflit
 */
export function computeDailySlots(dateStr, personName, durationMinutes = 30, allRdvs = [], personConfig = null, ignoreRdvId = null) {
    const workingRanges = getEffectiveWorkingRanges(personConfig, dateStr);

    // RDVs existants pour cette personne à cette date (non annulés)
    const existingRdvs = allRdvs.filter(
        (r) =>
            r.date === dateStr &&
            r.statut !== 'annule' &&
            r.id !== ignoreRdvId &&
            (!personName || (r.quiGere || '').toLowerCase() === personName.toLowerCase())
    );

    const stepMinutes = 15; // Granularité de 15 minutes
    const startHour = 8;
    const endHour = 20;

    const slots = [];
    const totalDuration = Number(durationMinutes) || 30;

    for (let h = startHour; h < endHour; h++) {
        for (let m = 0; m < 60; m += stepMinutes) {
            const slotStart = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
            const slotEnd = minutesToTime(timeToMinutes(slotStart) + totalDuration);

            // Vérifier si le créneau dépasse l'amplitude
            if (timeToMinutes(slotEnd) > endHour * 60) continue;

            // A. Vérifier si le créneau entier s'inscrit dans les plages de disponibilité
            const slotStartMin = timeToMinutes(slotStart);
            const slotEndMin = timeToMinutes(slotEnd);

            const isWithinWorkingHours = workingRanges.some((range) => {
                const rStart = timeToMinutes(range.start);
                const rEnd = timeToMinutes(range.end);
                return slotStartMin >= rStart && slotEndMin <= rEnd;
            });

            // B. Vérifier s'il y a un conflit avec un RDV existant
            const conflictingRdv = existingRdvs.find((r) =>
                doIntervalsOverlap(slotStart, slotEnd, r.heureDebut, r.heureFin)
            );

            let status = 'disponible';
            let reason = 'Disponible';

            if (conflictingRdv) {
                status = 'conflit';
                reason = `Créneau occupé : ${conflictingRdv.clientNom || 'RDV'} (${conflictingRdv.heureDebut} - ${conflictingRdv.heureFin})`;
            } else if (!isWithinWorkingHours) {
                status = 'hors_dispo';
                reason = workingRanges.length === 0 ? 'Journée non travaillée' : 'En dehors des horaires de disponibilité';
            }

            slots.push({
                time: slotStart,
                endTime: slotEnd,
                status,
                reason,
                conflictingRdv,
                disabled: status !== 'disponible',
            });
        }
    }

    return slots;
}

/**
 * Valide si un RDV spécifique est en conflit
 */
export function checkRdvConflict(dateStr, personName, heureDebut, heureFin, allRdvs, ignoreRdvId = null) {
    const existing = allRdvs.filter(
        (r) =>
            r.date === dateStr &&
            r.statut !== 'annule' &&
            r.id !== ignoreRdvId &&
            (!personName || (r.quiGere || '').toLowerCase() === personName.toLowerCase())
    );

    return existing.find((r) => doIntervalsOverlap(heureDebut, heureFin, r.heureDebut, r.heureFin)) || null;
}
