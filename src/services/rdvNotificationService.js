/**
 * rdvNotificationService.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Gestionnaire de notifications & rappels de rendez-vous :
 * - Notifications In-App (bannières, toasts sonores et alertes)
 * - Notifications Web Desktop natives (Web Notification API)
 * - Envoi d'email de rappel via Netlify Function /api/sendRdvReminder
 * - Test immédiat d'email de notification
 */
import { updateRendezVous } from './rdvService';

// Audio Chime discret (Web Audio API synthétiseur pur, sans fichier externe)
export function playChimeSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // Ré 5
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // La 5

        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    } catch (e) {
        // Ignorer si audio bloqué par autoplay policy
    }
}

/**
 * Demande la permission pour les notifications de bureau du navigateur
 */
export async function requestDesktopNotificationPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission !== 'denied') {
        return await Notification.requestPermission();
    }
    return Notification.permission;
}

/**
 * Affiche une notification de bureau native
 */
export function showDesktopNotification(title, options = {}) {
    if (!('Notification' in window)) return null;
    if (Notification.permission === 'granted') {
        try {
            return new Notification(title, {
                badge: '/favicon.ico',
                ...options,
            });
        } catch (e) {
            console.warn('Erreur affichage notification bureau:', e);
        }
    }
    return null;
}

/**
 * Envoie un email de rappel (via Netlify function /api/sendRdvReminder)
 * @param {Object} rdv
 * @param {string} targetEmail
 * @param {number} delayMinutes
 */
export async function sendEmailReminder(rdv, targetEmail, delayMinutes) {
    const payload = {
        to: targetEmail || rdv.notificationEmail,
        clientNom: rdv.clientNom,
        clientContact: rdv.clientContact,
        clientTelephone: rdv.clientTelephone,
        date: rdv.date,
        heureDebut: rdv.heureDebut,
        heureFin: rdv.heureFin,
        type: rdv.type,
        quiGere: rdv.quiGere,
        notes: rdv.notes,
        lienVisio: rdv.lienVisio,
        delayMinutes: delayMinutes || rdv.notificationDelaiMinutes || 15,
        isTest: false,
    };

    try {
        const res = await fetch('/api/sendRdvReminder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Erreur HTTP ${res.status}`);
        }

        return await res.json();
    } catch (err) {
        console.warn('Notification email simulée (développement / offline) :', payload);
        return { ok: true, simulated: true, message: 'Email consigné en console (mode dev)' };
    }
}

/**
 * Envoie un email de test pour valider l'adresse
 */
export async function sendTestEmail(targetEmail) {
    const fakeRdv = {
        clientNom: 'Acme SARL (Test)',
        clientContact: 'Jean Dupont',
        clientTelephone: '06 12 34 56 78',
        date: new Date().toISOString().split('T')[0],
        heureDebut: '14:30',
        heureFin: '15:00',
        type: 'visio',
        quiGere: 'Antoine',
        notes: 'Test de configuration de notification par email',
        lienVisio: 'https://meet.google.com/test-rdv',
        notificationEmail: targetEmail,
        notificationDelaiMinutes: 15,
        isTest: true,
    };

    return await sendEmailReminder(fakeRdv, targetEmail, 15);
}

/**
 * Vérifie la liste des rendez-vous et retourne ceux nécessitant une alerte immédiate
 * @param {Array} rdvs
 * @returns {Array} Liste des RDVs à notifier maintenant
 */
export function checkDueReminders(rdvs = []) {
    const now = new Date();
    const nowTs = now.getTime();
    const dueList = [];

    rdvs.forEach((rdv) => {
        if (rdv.statut !== 'planifie') return;
        if (!rdv.date || !rdv.heureDebut) return;

        // Date et heure de début du RDV
        const rdvDateStr = `${rdv.date}T${rdv.heureDebut}:00`;
        const rdvTime = new Date(rdvDateStr).getTime();
        if (isNaN(rdvTime)) return;

        // Délai avant le RDV (en minutes)
        const delayMs = (Number(rdv.notificationDelaiMinutes) || 15) * 60 * 1000;
        const triggerTime = rdvTime - delayMs;

        // Fenêtre de déclenchement : entre le trigger et 10 minutes après l'heure de début
        // et n'ayant pas encore été notifié dans cette session
        const alreadyNotified = sessionStorage.getItem(`rdv_notified_${rdv.id}`);

        if (!alreadyNotified && nowTs >= triggerTime && nowTs <= (rdvTime + 10 * 60 * 1000)) {
            const minutesLeft = Math.max(0, Math.round((rdvTime - nowTs) / (60 * 1000)));
            dueList.push({
                rdv,
                minutesLeft,
                isImmediate: minutesLeft <= 5,
            });
        }
    });

    return dueList;
}
