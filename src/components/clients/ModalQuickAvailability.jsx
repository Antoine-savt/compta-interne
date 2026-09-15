/**
 * ModalQuickAvailability.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Hub ultra-rapide et ergonomique de consultation des disponibilités et de réservation
 * instantanée de créneaux pendant un appel téléphonique avec un client ou prospect.
 * 
 * Atouts majeurs pour l'appel :
 * - 0ms de latence, actualisation en temps réel des créneaux libres.
 * - Sélecteur de gérant (Antoine, Thomas, Théophile...) + vue comparée de toute l'équipe.
 * - Raccourcis de dates : Aujourd'hui, Demain, +2j, +3j, Lundi prochain + sélecteur DateInput.
 * - Détection automatique du prochain jour ouvré disponible si la journée est pleine ou fermée.
 * - Découpage clair Matin / Après-midi avec filtre "Créneaux libres uniquement".
 * - Réservation en 1 clic SANS attribution obligatoire à un client.
 * - Bouton de copie rapide du créneau dans le presse-papier (SMS / WhatsApp / Mail).
 * 
 * Contrainte stricte : AUCUN EMOJI. Icônes vectorielles SVG épurées.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import {
    computeDailySlots,
    getDisponibilitesSettings,
    timeToMinutes,
} from '../../services/rdvAvailabilityService';
import { getAllRendezVous, createRendezVous } from '../../services/rdvService';
import { getUnifiedGestionnaires } from '../../services/crmGestionnairesService';
import { toISODate, formatDate } from '../../services/helpers';
import { DateInput } from '../common/DateInput';

const DURATION_OPTIONS = [
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 45, label: '45 min' },
    { value: 60, label: '1 heure' },
];

function formatFullDayFr(dateStr) {
    if (!dateStr) return '';
    try {
        const [y, m, d] = dateStr.split('-');
        const dt = new Date(Number(y), Number(m) - 1, Number(d));
        const formatted = dt.toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch {
        return dateStr;
    }
}

export default function ModalQuickAvailability({
    onClose,
    clients = [],
    initialGestionnaire = '',
    onRdvBooked,
}) {
    // ─── Données d'équipe & Rendez-vous ───────────────────────────────────────
    const [teamMembers, setTeamMembers] = useState(['Antoine', 'Thomas']);
    const [selectedManager, setSelectedManager] = useState(initialGestionnaire || 'Antoine');
    const [disponibilitesSettings, setDisponibilitesSettings] = useState({});
    const [allRdvs, setAllRdvs] = useState([]);
    const [loadingData, setLoadingData] = useState(true);

    // ─── Mode comparatif d'équipe ─────────────────────────────────────────────
    const [isTeamCompareMode, setIsTeamCompareMode] = useState(false);

    // ─── Paramètres de créneaux ───────────────────────────────────────────────
    const [activeDate, setActiveDate] = useState(() => toISODate(new Date()));
    const [durationMinutes, setDurationMinutes] = useState(30);
    const [onlyFreeSlots, setOnlyFreeSlots] = useState(true);

    // ─── Sélection & Réservation d'un créneau ─────────────────────────────────
    const [selectedSlot, setSelectedSlot] = useState(null); // { time, endTime, manager, date }
    const [reservationTitle, setReservationTitle] = useState('Créneau réservé (Appel en cours)');
    const [reservationClientId, setReservationClientId] = useState('');
    const [reservationType, setReservationType] = useState('visio'); // 'visio' | 'telephone' | 'presentiel'
    const [reservationNotes, setReservationNotes] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [bookingSuccess, setBookingSuccess] = useState(null);
    const [copiedText, setCopiedText] = useState(false);

    // Recherche de client optionnel
    const [clientQuery, setClientQuery] = useState('');
    const [showClientPicker, setShowClientPicker] = useState(false);
    const clientPickerRef = useRef(null);

    // ─── Chargement initial des données ───────────────────────────────────────
    useEffect(() => {
        let isMounted = true;
        async function loadAll() {
            setLoadingData(true);
            try {
                const [members, settings, rdvs] = await Promise.all([
                    getUnifiedGestionnaires(),
                    getDisponibilitesSettings(),
                    getAllRendezVous(),
                ]);
                if (!isMounted) return;
                const effectiveMembers = Array.isArray(members) && members.length > 0 ? members : ['Antoine', 'Thomas'];
                setTeamMembers(effectiveMembers);
                if (!initialGestionnaire || !effectiveMembers.includes(initialGestionnaire)) {
                    setSelectedManager(effectiveMembers[0] || 'Antoine');
                }
                setDisponibilitesSettings(settings || {});
                setAllRdvs(Array.isArray(rdvs) ? rdvs : []);
            } catch (err) {
                console.error('Erreur chargement ModalQuickAvailability:', err);
            } finally {
                if (isMounted) setLoadingData(false);
            }
        }
        loadAll();
        return () => { isMounted = false; };
    }, [initialGestionnaire]);

    // Fermeture du sélecteur de client en cliquant dehors
    useEffect(() => {
        function handleClickOutside(e) {
            if (clientPickerRef.current && !clientPickerRef.current.contains(e.target)) {
                setShowClientPicker(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // ─── Raccourcis de dates rapides ──────────────────────────────────────────
    const dateShortcuts = useMemo(() => {
        const today = new Date();
        const addDays = (num) => {
            const d = new Date(today);
            d.setDate(d.getDate() + num);
            return toISODate(d);
        };

        // Trouver le lundi suivant
        const nextMonday = new Date(today);
        const dayOfWeek = today.getDay(); // 0: Dim, 1: Lun ...
        const daysUntilNextMon = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
        nextMonday.setDate(today.getDate() + daysUntilNextMon);

        return [
            { label: "Aujourd'hui", date: addDays(0) },
            { label: 'Demain', date: addDays(1) },
            { label: '+2 jours', date: addDays(2) },
            { label: '+3 jours', date: addDays(3) },
            { label: 'Lundi prochain', date: toISODate(nextMonday) },
        ];
    }, []);

    // Navigation Jour précédent / Jour suivant
    function handleShiftDay(daysDelta) {
        if (!activeDate) return;
        const [y, m, d] = activeDate.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        dt.setDate(dt.getDate() + daysDelta);
        setActiveDate(toISODate(dt));
        setSelectedSlot(null);
        setBookingSuccess(null);
    }

    // ─── Calcul des créneaux pour un gestionnaire donné ────────────────────────
    function getSlotsForManager(managerName, dateStr) {
        if (!dateStr || !managerName) return [];
        const personConfig = disponibilitesSettings[managerName] || null;
        return computeDailySlots(dateStr, managerName, durationMinutes, allRdvs, personConfig);
    }

    // Créneaux du gestionnaire actif
    const activeManagerSlots = useMemo(() => {
        return getSlotsForManager(selectedManager, activeDate);
    }, [selectedManager, activeDate, durationMinutes, allRdvs, disponibilitesSettings]);

    // Découpage Matin (< 13:00) / Après-midi (>= 13:00)
    const { morningSlots, afternoonSlots } = useMemo(() => {
        const morning = [];
        const afternoon = [];

        activeManagerSlots.forEach((slot) => {
            if (onlyFreeSlots && slot.status !== 'disponible') return;
            const minutes = timeToMinutes(slot.time);
            if (minutes < 780) { // Avant 13h00
                morning.push(slot);
            } else {
                afternoon.push(slot);
            }
        });

        return { morningSlots: morning, afternoonSlots: afternoon };
    }, [activeManagerSlots, onlyFreeSlots]);

    const totalFreeSlotsCount = useMemo(() => {
        return activeManagerSlots.filter((s) => s.status === 'disponible').length;
    }, [activeManagerSlots]);

    // Comptage des créneaux disponibles pour chaque membre aujourd'hui / à la date choisie
    const teamSlotsCountMap = useMemo(() => {
        const map = {};
        teamMembers.forEach((m) => {
            const slots = getSlotsForManager(m, activeDate);
            map[m] = slots.filter((s) => s.status === 'disponible').length;
        });
        return map;
    }, [teamMembers, activeDate, durationMinutes, allRdvs, disponibilitesSettings]);

    // Recherche automatique du prochain jour avec disponibilités
    function handleFindNextAvailableDay() {
        const [y, m, d] = activeDate.split('-').map(Number);
        const dt = new Date(y, m - 1, d);

        for (let i = 1; i <= 30; i++) {
            dt.setDate(dt.getDate() + 1);
            const candidateDate = toISODate(dt);
            const slots = getSlotsForManager(selectedManager, candidateDate);
            const free = slots.filter((s) => s.status === 'disponible');
            if (free.length > 0) {
                setActiveDate(candidateDate);
                setSelectedSlot(null);
                setBookingSuccess(null);
                return;
            }
        }
        alert("Aucune disponibilité trouvée sur les 30 prochains jours pour ce gestionnaire.");
    }

    // Clients filtrés pour l'assignation optionnelle
    const filteredClients = useMemo(() => {
        if (!clientQuery.trim()) return clients.slice(0, 10);
        const q = clientQuery.toLowerCase();
        return clients
            .filter((c) => (c.nom || '').toLowerCase().includes(q) || (c.contactNom || '').toLowerCase().includes(q) || (c.contactPrenom || '').toLowerCase().includes(q))
            .slice(0, 10);
    }, [clients, clientQuery]);

    const chosenClientObj = useMemo(() => {
        if (!reservationClientId) return null;
        return clients.find((c) => c.id === reservationClientId) || null;
    }, [clients, reservationClientId]);

    // Clic sur un créneau
    function handleSlotClick(slot, manager = selectedManager) {
        if (slot.status !== 'disponible') return;

        setSelectedSlot({
            date: activeDate,
            time: slot.time,
            endTime: slot.endTime,
            manager,
        });
        setBookingSuccess(null);
        setReservationTitle('Créneau réservé (Appel en cours)');
        setReservationClientId('');
        setReservationNotes('');
    }

    // Validation de la réservation instantanée
    async function handleConfirmBooking() {
        if (!selectedSlot) return;
        setIsSaving(true);

        const rdvPayload = {
            clientId: reservationClientId || '',
            clientNom: chosenClientObj?.nom || reservationTitle.trim() || 'Réservation appel',
            clientContact: chosenClientObj ? `${chosenClientObj.contactPrenom || ''} ${chosenClientObj.contactNom || ''}`.trim() : '',
            clientTelephone: chosenClientObj?.telephone || '',
            clientEmail: chosenClientObj?.email || '',
            quiGere: selectedSlot.manager,
            date: selectedSlot.date,
            heureDebut: selectedSlot.time,
            heureFin: selectedSlot.endTime,
            dureeMinutes: Number(durationMinutes),
            type: reservationType,
            notes: reservationNotes.trim(),
            statut: 'planifie',
            notificationEmail: '',
            notificationDelaiMinutes: 15,
        };

        try {
            const created = await createRendezVous(rdvPayload);
            // Mettre à jour allRdvs localement pour un rafraîchissement immédiat
            const refreshed = await getAllRendezVous();
            setAllRdvs(refreshed);

            setBookingSuccess({
                ...rdvPayload,
                id: created?.id,
            });

            if (onRdvBooked) {
                onRdvBooked(created);
            }
        } catch (err) {
            console.error('Erreur réservation créneau rapide:', err);
            alert("Une erreur est survenue lors de l'enregistrement du rendez-vous.");
        } finally {
            setIsSaving(false);
        }
    }

    // Copie du récapitulatif du RDV
    function handleCopyRdvSummary() {
        if (!selectedSlot) return;
        const typeLabel = reservationType === 'visio' ? 'Visio' : reservationType === 'telephone' ? 'Appel tél.' : 'Présentiel';
        const clientLabel = chosenClientObj?.nom || reservationTitle || 'Rendez-vous';
        const text = `Rendez-vous : ${formatFullDayFr(selectedSlot.date)} de ${selectedSlot.time} à ${selectedSlot.endTime} avec ${selectedSlot.manager} (${typeLabel}). ${clientLabel}`;

        navigator.clipboard.writeText(text).then(() => {
            setCopiedText(true);
            setTimeout(() => setCopiedText(false), 2500);
        });
    }

    return (
        <div
            className="modal-backdrop"
            onClick={onClose}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.72)',
                backdropFilter: 'blur(5px)',
                zIndex: 99999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '16px',
            }}
        >
            <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: 1040,
                    width: '100%',
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg)',
                    borderRadius: 14,
                    border: '1px solid var(--border)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.45)',
                    overflow: 'hidden',
                }}
            >
                {/* ─── EN-TÊTE DU HUB DISPONIBILITÉS ───────────────────────────── */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '14px 22px',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--bg2)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                background: 'rgba(56, 189, 248, 0.12)',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--accent)',
                            }}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10"></circle>
                                <polyline points="12 6 12 12 16 14"></polyline>
                            </svg>
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                                    Disponibilités & Réservation rapide
                                </h2>
                                <span
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 5,
                                        padding: '2px 8px',
                                        borderRadius: 12,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        background: 'rgba(16, 185, 129, 0.12)',
                                        color: '#10b981',
                                        border: '1px solid rgba(16, 185, 129, 0.25)',
                                    }}
                                >
                                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                                    Temps réel
                                </span>
                            </div>
                            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
                                Consultez les créneaux libres en direct et bloquez une date instantanément pendant votre appel.
                            </p>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn--ghost btn--sm"
                        style={{ width: 32, height: 32, padding: 0, borderRadius: 6, fontSize: 14, color: 'var(--text-muted)' }}
                        title="Fermer"
                    >
                        ✕
                    </button>
                </div>

                {/* ─── CORPS DU HUB ───────────────────────────────────────────── */}
                <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 480 }}>
                    {/* ═══ COLONNE PRINCIPALE : VUE CALENDRIER & CRÉNEAUX ═══════ */}
                    <div
                        style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            overflowY: 'auto',
                            padding: '16px 22px',
                            borderRight: selectedSlot ? '1px solid var(--border)' : 'none',
                        }}
                    >
                        {/* 1. Sélecteur de gérant & mode équipe */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginRight: 4 }}>
                                    Gestionnaire :
                                </span>
                                {teamMembers.map((member) => {
                                    const isSelected = !isTeamCompareMode && selectedManager === member;
                                    const freeCount = teamSlotsCountMap[member] || 0;
                                    return (
                                        <button
                                            key={member}
                                            type="button"
                                            onClick={() => {
                                                setIsTeamCompareMode(false);
                                                setSelectedManager(member);
                                                setSelectedSlot(null);
                                                setBookingSuccess(null);
                                            }}
                                            className={`btn btn--sm ${isSelected ? 'btn--primary' : 'btn--ghost'}`}
                                            style={{
                                                fontSize: 12,
                                                fontWeight: 600,
                                                padding: '4px 10px',
                                                borderRadius: 6,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 6,
                                            }}
                                        >
                                            <span>{member}</span>
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    padding: '1px 5px',
                                                    borderRadius: 10,
                                                    background: isSelected ? 'rgba(255,255,255,0.22)' : 'var(--bg3)',
                                                    color: isSelected ? '#fff' : (freeCount > 0 ? '#10b981' : 'var(--text-light)'),
                                                    fontWeight: 700,
                                                }}
                                            >
                                                {freeCount}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>

                            <button
                                type="button"
                                onClick={() => {
                                    setIsTeamCompareMode((prev) => !prev);
                                    setSelectedSlot(null);
                                    setBookingSuccess(null);
                                }}
                                className={`btn btn--sm ${isTeamCompareMode ? 'btn--primary' : 'btn--secondary'}`}
                                style={{ fontSize: 11, padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 5 }}
                            >
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                                    <circle cx="9" cy="7" r="4"></circle>
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                                </svg>
                                <span>{isTeamCompareMode ? 'Vue individuelle' : "Comparer l'équipe"}</span>
                            </button>
                        </div>

                        {/* 2. Barre de Date : Raccourcis + Navigation + DateInput */}
                        <div
                            style={{
                                background: 'var(--bg2)',
                                border: '1px solid var(--border)',
                                borderRadius: 10,
                                padding: '10px 14px',
                                marginBottom: 14,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 10,
                            }}
                        >
                            {/* Raccourcis de jours */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                {dateShortcuts.map((sc) => {
                                    const isCurrent = activeDate === sc.date;
                                    return (
                                        <button
                                            key={sc.label}
                                            type="button"
                                            onClick={() => {
                                                setActiveDate(sc.date);
                                                setSelectedSlot(null);
                                                setBookingSuccess(null);
                                            }}
                                            className={`btn btn--sm ${isCurrent ? 'btn--primary' : 'btn--ghost'}`}
                                            style={{
                                                fontSize: 11,
                                                padding: '3px 9px',
                                                borderRadius: 5,
                                                fontWeight: isCurrent ? 700 : 500,
                                            }}
                                        >
                                            {sc.label}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Barre de navigation directe dans le calendrier */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <button
                                        type="button"
                                        onClick={() => handleShiftDay(-1)}
                                        className="btn btn--ghost btn--sm"
                                        style={{ width: 28, height: 28, padding: 0 }}
                                        title="Jour précédent"
                                    >
                                        ◀
                                    </button>
                                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                                        {formatFullDayFr(activeDate)}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleShiftDay(1)}
                                        className="btn btn--ghost btn--sm"
                                        style={{ width: 28, height: 28, padding: 0 }}
                                        title="Jour suivant"
                                    >
                                        ▶
                                    </button>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{ width: 140 }}>
                                        <DateInput
                                            value={activeDate}
                                            onChange={(newVal) => {
                                                if (newVal) {
                                                    setActiveDate(newVal);
                                                    setSelectedSlot(null);
                                                    setBookingSuccess(null);
                                                }
                                            }}
                                            placeholder="Choisir date"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* 3. Sélecteur de Durée & Filtres d'affichage */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                                    Durée du RDV :
                                </span>
                                {DURATION_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setDurationMinutes(opt.value)}
                                        className={`btn btn--sm ${durationMinutes === opt.value ? 'btn--primary' : 'btn--ghost'}`}
                                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                                <input
                                    type="checkbox"
                                    checked={onlyFreeSlots}
                                    onChange={(e) => setOnlyFreeSlots(e.target.checked)}
                                    style={{ cursor: 'pointer' }}
                                />
                                <span>Créneaux libres uniquement</span>
                            </label>
                        </div>

                        {/* 4. GRILLE DES CRÉNEAUX */}
                        {loadingData ? (
                            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                                Calcul des disponibilités en cours...
                            </div>
                        ) : isTeamCompareMode ? (
                            /* ─── VUE ÉQUIPE COMPARÉE ─── */
                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${teamMembers.length}, 1fr)`, gap: 14 }}>
                                {teamMembers.map((member) => {
                                    const slots = getSlotsForManager(member, activeDate);
                                    const freeSlots = slots.filter((s) => s.status === 'disponible');

                                    return (
                                        <div
                                            key={member}
                                            style={{
                                                background: 'var(--bg2)',
                                                border: '1px solid var(--border)',
                                                borderRadius: 8,
                                                padding: 12,
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 8,
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 6 }}>
                                                <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{member}</span>
                                                <span style={{ fontSize: 11, color: freeSlots.length > 0 ? '#10b981' : 'var(--text-light)', fontWeight: 600 }}>
                                                    {freeSlots.length} libre{freeSlots.length > 1 ? 's' : ''}
                                                </span>
                                            </div>

                                            {freeSlots.length === 0 ? (
                                                <div style={{ fontSize: 11, color: 'var(--text-light)', padding: '12px 0', textAlign: 'center' }}>
                                                    Aucun créneau libre
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 380, overflowY: 'auto' }}>
                                                    {freeSlots.map((s) => (
                                                        <button
                                                            key={s.time}
                                                            type="button"
                                                            onClick={() => handleSlotClick(s, member)}
                                                            className="btn btn--ghost btn--sm"
                                                            style={{
                                                                justifyContent: 'space-between',
                                                                fontSize: 11,
                                                                padding: '6px 8px',
                                                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                                                background: 'rgba(16, 185, 129, 0.06)',
                                                                color: 'var(--text)',
                                                                borderRadius: 5,
                                                            }}
                                                        >
                                                            <span style={{ fontWeight: 700, color: '#10b981' }}>{s.time}</span>
                                                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>→ {s.endTime}</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            /* ─── VUE INDIVIDUELLE DU GÉRANT SÉLECTIONNÉ ─── */
                            <div>
                                {totalFreeSlotsCount === 0 && (
                                    <div
                                        style={{
                                            padding: '24px 20px',
                                            borderRadius: 8,
                                            background: 'var(--bg2)',
                                            border: '1px solid var(--border)',
                                            textAlign: 'center',
                                            marginBottom: 16,
                                        }}
                                    >
                                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>
                                            Aucun créneau libre pour {selectedManager} le {formatDate(activeDate)}
                                        </div>
                                        <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                                            Cette journée est fermée, entièrement occupée ou correspond à un jour de repos.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={handleFindNextAvailableDay}
                                            className="btn btn--primary btn--sm"
                                            style={{ fontSize: 12 }}
                                        >
                                            Aller au prochain jour avec des créneaux libres
                                        </button>
                                    </div>
                                )}

                                {/* MATIN */}
                                {morningSlots.length > 0 && (
                                    <div style={{ marginBottom: 18 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                                                Matinée (08:00 - 12:30)
                                            </span>
                                            <span style={{ fontSize: 10, color: 'var(--text-light)' }}>
                                                ({morningSlots.filter((s) => s.status === 'disponible').length} disponible{morningSlots.filter((s) => s.status === 'disponible').length > 1 ? 's' : ''})
                                            </span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: 7 }}>
                                            {morningSlots.map((slot) => {
                                                const isSelected = selectedSlot && selectedSlot.time === slot.time && selectedSlot.manager === selectedManager;
                                                const isFree = slot.status === 'disponible';

                                                return (
                                                    <button
                                                        key={slot.time}
                                                        type="button"
                                                        disabled={!isFree}
                                                        onClick={() => handleSlotClick(slot)}
                                                        style={{
                                                            padding: '8px 10px',
                                                            borderRadius: 6,
                                                            border: isSelected
                                                                ? '2px solid var(--accent)'
                                                                : isFree
                                                                    ? '1px solid rgba(16, 185, 129, 0.4)'
                                                                    : '1px solid var(--border)',
                                                            background: isSelected
                                                                ? 'rgba(56, 189, 248, 0.15)'
                                                                : isFree
                                                                    ? 'rgba(16, 185, 129, 0.08)'
                                                                    : 'var(--bg3)',
                                                            color: isFree ? 'var(--text)' : 'var(--text-light)',
                                                            cursor: isFree ? 'pointer' : 'not-allowed',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            alignItems: 'flex-start',
                                                            gap: 2,
                                                            transition: 'all 0.12s ease',
                                                            textAlign: 'left',
                                                        }}
                                                        title={slot.reason}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                                            <span style={{ fontSize: 13, fontWeight: 700, color: isFree ? '#10b981' : 'inherit' }}>
                                                                {slot.time}
                                                            </span>
                                                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                                                {slot.endTime}
                                                            </span>
                                                        </div>
                                                        <span style={{ fontSize: 9, color: isFree ? 'var(--text-muted)' : 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                                                            {isFree ? 'Libre • Cliquer' : (slot.conflictingRdv?.clientNom || 'Occupé')}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                {/* APRÈS-MIDI */}
                                {afternoonSlots.length > 0 && (
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--text-muted)' }}>
                                                Après-midi (13:30 - 19:30)
                                            </span>
                                            <span style={{ fontSize: 10, color: 'var(--text-light)' }}>
                                                ({afternoonSlots.filter((s) => s.status === 'disponible').length} disponible{afternoonSlots.filter((s) => s.status === 'disponible').length > 1 ? 's' : ''})
                                            </span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))', gap: 7 }}>
                                            {afternoonSlots.map((slot) => {
                                                const isSelected = selectedSlot && selectedSlot.time === slot.time && selectedSlot.manager === selectedManager;
                                                const isFree = slot.status === 'disponible';

                                                return (
                                                    <button
                                                        key={slot.time}
                                                        type="button"
                                                        disabled={!isFree}
                                                        onClick={() => handleSlotClick(slot)}
                                                        style={{
                                                            padding: '8px 10px',
                                                            borderRadius: 6,
                                                            border: isSelected
                                                                ? '2px solid var(--accent)'
                                                                : isFree
                                                                    ? '1px solid rgba(16, 185, 129, 0.4)'
                                                                    : '1px solid var(--border)',
                                                            background: isSelected
                                                                ? 'rgba(56, 189, 248, 0.15)'
                                                                : isFree
                                                                    ? 'rgba(16, 185, 129, 0.08)'
                                                                    : 'var(--bg3)',
                                                            color: isFree ? 'var(--text)' : 'var(--text-light)',
                                                            cursor: isFree ? 'pointer' : 'not-allowed',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                            alignItems: 'flex-start',
                                                            gap: 2,
                                                            transition: 'all 0.12s ease',
                                                            textAlign: 'left',
                                                        }}
                                                        title={slot.reason}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                                            <span style={{ fontSize: 13, fontWeight: 700, color: isFree ? '#10b981' : 'inherit' }}>
                                                                {slot.time}
                                                            </span>
                                                            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                                                {slot.endTime}
                                                            </span>
                                                        </div>
                                                        <span style={{ fontSize: 9, color: isFree ? 'var(--text-muted)' : 'var(--danger)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                                                            {isFree ? 'Libre • Cliquer' : (slot.conflictingRdv?.clientNom || 'Occupé')}
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ═══ COLONNE DROITE : RÉSERVATION RAPIDE EN 1 CLIC ════════ */}
                    {selectedSlot && (
                        <div
                            style={{
                                width: 330,
                                background: 'var(--bg2)',
                                padding: '16px 18px',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 14,
                                overflowY: 'auto',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: 10 }}>
                                <div>
                                    <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--accent)', fontWeight: 700 }}>
                                        Créneau sélectionné
                                    </div>
                                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>
                                        {selectedSlot.time} - {selectedSlot.endTime}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                        {formatDate(selectedSlot.date)} • {selectedSlot.manager}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedSlot(null)}
                                    className="btn btn--ghost btn--sm"
                                    style={{ fontSize: 12, padding: '2px 6px' }}
                                >
                                    ✕
                                </button>
                            </div>

                            {bookingSuccess ? (
                                /* ÉCRAN DE SUCCÈS */
                                <div
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        textAlign: 'center',
                                        padding: '20px 10px',
                                        gap: 12,
                                    }}
                                >
                                    <div
                                        style={{
                                            width: 44,
                                            height: 44,
                                            borderRadius: '50%',
                                            background: 'rgba(16, 185, 129, 0.15)',
                                            border: '2px solid #10b981',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#10b981',
                                        }}
                                    >
                                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12"></polyline>
                                        </svg>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                                            Créneau bloqué avec succès !
                                        </div>
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                            Le créneau est désormais réservé dans l'agenda pour {selectedSlot.manager}.
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleCopyRdvSummary}
                                        className="btn btn--secondary btn--sm"
                                        style={{ width: '100%', fontSize: 11, marginTop: 6 }}
                                    >
                                        {copiedText ? '✓ Récapitulatif copié !' : 'Copier le texte du RDV'}
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedSlot(null);
                                            setBookingSuccess(null);
                                        }}
                                        className="btn btn--primary btn--sm"
                                        style={{ width: '100%', fontSize: 11 }}
                                    >
                                        Bloquer un autre créneau
                                    </button>
                                </div>
                            ) : (
                                /* FORMULAIRE INSTANTANÉ (AUCUN CLIENT OBLIGATOIRE) */
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    {/* 1. Intitulé / Nom du RDV */}
                                    <div>
                                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                                            Intitulé / Nom du contact
                                        </label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={reservationTitle}
                                            onChange={(e) => setReservationTitle(e.target.value)}
                                            placeholder="Ex. Appel prospect, Démo..."
                                            style={{ fontSize: 12, height: 32 }}
                                        />
                                    </div>

                                    {/* 2. Client optionnel */}
                                    <div ref={clientPickerRef} style={{ position: 'relative' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>
                                                Associer à un client (optionnel)
                                            </label>
                                            {chosenClientObj && (
                                                <button
                                                    type="button"
                                                    onClick={() => setReservationClientId('')}
                                                    style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, cursor: 'pointer' }}
                                                >
                                                    Détacher
                                                </button>
                                            )}
                                        </div>

                                        {chosenClientObj ? (
                                            <div
                                                style={{
                                                    padding: '6px 10px',
                                                    borderRadius: 6,
                                                    background: 'var(--bg)',
                                                    border: '1px solid var(--border)',
                                                    fontSize: 12,
                                                    fontWeight: 600,
                                                    color: 'var(--text)',
                                                }}
                                            >
                                                {chosenClientObj.nom}
                                            </div>
                                        ) : (
                                            <div>
                                                <input
                                                    type="text"
                                                    className="form-input"
                                                    value={clientQuery}
                                                    onChange={(e) => {
                                                        setClientQuery(e.target.value);
                                                        setShowClientPicker(true);
                                                    }}
                                                    onFocus={() => setShowClientPicker(true)}
                                                    placeholder="Rechercher un client existant..."
                                                    style={{ fontSize: 11, height: 30 }}
                                                />
                                                {showClientPicker && (
                                                    <div
                                                        style={{
                                                            position: 'absolute',
                                                            top: '100%',
                                                            left: 0,
                                                            right: 0,
                                                            background: 'var(--bg)',
                                                            border: '1px solid var(--border)',
                                                            borderRadius: 6,
                                                            boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
                                                            zIndex: 100,
                                                            maxHeight: 180,
                                                            overflowY: 'auto',
                                                            marginTop: 3,
                                                        }}
                                                    >
                                                        {filteredClients.length === 0 ? (
                                                            <div style={{ padding: '8px 10px', fontSize: 11, color: 'var(--text-light)' }}>
                                                                Aucun client trouvé
                                                            </div>
                                                        ) : (
                                                            filteredClients.map((c) => (
                                                                <div
                                                                    key={c.id}
                                                                    onClick={() => {
                                                                        setReservationClientId(c.id);
                                                                        setReservationTitle(c.nom);
                                                                        setShowClientPicker(false);
                                                                    }}
                                                                    style={{
                                                                        padding: '6px 10px',
                                                                        fontSize: 11,
                                                                        cursor: 'pointer',
                                                                        borderBottom: '1px solid var(--border)',
                                                                    }}
                                                                    className="crm-popover-item"
                                                                >
                                                                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{c.nom}</div>
                                                                    {c.contactPrenom && (
                                                                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                                                            {c.contactPrenom} {c.contactNom}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* 3. Format du RDV */}
                                    <div>
                                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                                            Format du RDV
                                        </label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 5 }}>
                                            {[
                                                { id: 'visio', label: 'Visio' },
                                                { id: 'telephone', label: 'Appel' },
                                                { id: 'presentiel', label: 'Sur place' },
                                            ].map((fmt) => (
                                                <button
                                                    key={fmt.id}
                                                    type="button"
                                                    onClick={() => setReservationType(fmt.id)}
                                                    className={`btn btn--sm ${reservationType === fmt.id ? 'btn--primary' : 'btn--ghost'}`}
                                                    style={{ fontSize: 11, padding: '5px 4px', textAlign: 'center', justifyContent: 'center' }}
                                                >
                                                    {fmt.label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* 4. Notes rapides */}
                                    <div>
                                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                                            Note rapide (optionnel)
                                        </label>
                                        <input
                                            type="text"
                                            className="form-input"
                                            value={reservationNotes}
                                            onChange={(e) => setReservationNotes(e.target.value)}
                                            placeholder="Ex. Rappel devis, numéro tél..."
                                            style={{ fontSize: 11, height: 30 }}
                                        />
                                    </div>

                                    {/* BOUTON D'ACTION PRINCIPAL : 1 CLIC */}
                                    <button
                                        type="button"
                                        disabled={isSaving}
                                        onClick={handleConfirmBooking}
                                        className="btn btn--primary"
                                        style={{
                                            marginTop: 6,
                                            padding: '9px 12px',
                                            fontSize: 12,
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: 8,
                                        }}
                                    >
                                        {isSaving ? 'Réservation en cours...' : 'Bloquer ce créneau maintenant'}
                                    </button>

                                    <div style={{ fontSize: 10, color: 'var(--text-light)', textAlign: 'center' }}>
                                        Bloque immédiatement l'horaire pour {selectedSlot.manager} et empêche tout doublon.
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
