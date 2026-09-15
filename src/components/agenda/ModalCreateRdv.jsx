/**
 * ModalCreateRdv.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Modale de planification et modification de Rendez-vous (RDV)
 * Interface ultra-soignée (inspiration Linear / Cal.com) :
 * - Sélecteur de client personnalisé avec recherche instantanée (aucun select natif moche)
 * - Champs de saisie stylisés haute-fidélité (.rdv-input, .rdv-select, .rdv-textarea)
 * - Sélecteur de format moderne (Visio, Appel, Présentiel)
 * - Raccourcis de date et filtres de créneaux matin/après-midi
 * - Zéro double barre de défilement, dimensions parfaitement ajustées
 * 
 * Contrainte stricte : STRICTEMENT AUCUN EMOJI. Icônes vectorielles SVG épurées.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { createRendezVous, updateRendezVous, deleteRendezVous, calculateEndTime } from '../../services/rdvService';
import {
    computeDailySlots,
    checkRdvConflict,
    getDisponibilitesSettings,
    minutesToTime,
    timeToMinutes,
} from '../../services/rdvAvailabilityService';
import { sendTestEmail } from '../../services/rdvNotificationService';
import { toISODate } from '../../services/helpers';
import { DateInput } from '../common/DateInput';

const DURATION_OPTIONS = [
    { value: 15, label: '15 min' },
    { value: 30, label: '30 min' },
    { value: 45, label: '45 min' },
    { value: 60, label: '1 heure' },
    { value: 90, label: '1h 30' },
    { value: 120, label: '2 heures' },
];

const REMINDER_OPTIONS = [
    { value: 5, label: '5 min avant' },
    { value: 10, label: '10 min avant' },
    { value: 15, label: '15 min avant' },
    { value: 30, label: '30 min avant' },
    { value: 60, label: '1h avant' },
    { value: 120, label: '2h avant' },
    { value: 1440, label: '24h avant (la veille)' },
];

function formatFullDateFr(dateStr) {
    if (!dateStr) return '';
    try {
        const [y, m, d] = dateStr.split('-');
        const dt = new Date(Number(y), Number(m) - 1, Number(d));
        const formatted = dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
    } catch {
        return dateStr;
    }
}

export default function ModalCreateRdv({
    initialRdv = null,
    preselectedClient = null,
    preselectedDate = '',
    preselectedTime = '',
    preselectedPerson = '',
    clients = [],
    gestionnaires = ['Antoine', 'Thomas'],
    allRdvs = [],
    onClose,
    onSaved,
    onDeleted,
}) {
    // Si un client présélectionné possède déjà un RDV planifié dans allRdvs ou sur sa fiche
    const clientExistingRdv = useMemo(() => {
        if (initialRdv) return initialRdv;
        if (preselectedClient?.id && allRdvs?.length > 0) {
            return (
                allRdvs.find(
                    (r) => r.clientId === preselectedClient.id && r.statut === 'planifie'
                ) || null
            );
        }
        return null;
    }, [initialRdv, preselectedClient, allRdvs]);

    const activeRdv = initialRdv || clientExistingRdv;
    const isEditing = Boolean(activeRdv?.id);

    // Initialisation du client
    const [clientId, setClientId] = useState(() => {
        if (activeRdv?.clientId) return activeRdv.clientId;
        if (preselectedClient?.id) return preselectedClient.id;
        return '';
    });
    const [clientSearch, setClientSearch] = useState('');
    const [showClientDropdown, setShowClientDropdown] = useState(false);
    const clientDropdownRef = useRef(null);

    const [quiGere, setQuiGere] = useState(() => {
        if (activeRdv?.quiGere) return activeRdv.quiGere;
        if (preselectedPerson) return preselectedPerson;
        if (preselectedClient?.quiGere) return preselectedClient.quiGere;
        return gestionnaires[0] || 'Antoine';
    });

    const [date, setDate] = useState(() => {
        if (activeRdv?.date) return activeRdv.date;
        if (preselectedDate) return preselectedDate;
        if (preselectedClient?.prochainRdvDate) return preselectedClient.prochainRdvDate;
        return toISODate(new Date());
    });

    const [dureeMinutes, setDureeMinutes] = useState(() => {
        if (activeRdv?.dureeMinutes) return Number(activeRdv.dureeMinutes);
        return 30;
    });

    const [heureDebut, setHeureDebut] = useState(() => {
        if (activeRdv?.heureDebut) return activeRdv.heureDebut;
        if (preselectedTime) return preselectedTime;
        if (preselectedClient?.prochainRdvHeure) return preselectedClient.prochainRdvHeure;
        return '14:00';
    });

    const [type, setType] = useState(() => {
        if (activeRdv?.type) return activeRdv.type;
        if (preselectedClient?.prochainRdvFormat) return preselectedClient.prochainRdvFormat;
        return 'visio';
    });

    const [notes, setNotes] = useState(() => activeRdv?.notes || preselectedClient?.prochainRdvObjet || '');
    const [lienVisio, setLienVisio] = useState(() => activeRdv?.lienVisio || preselectedClient?.prochainRdvLien || '');
    const [lieu, setLieu] = useState(() => activeRdv?.lieu || '');
    const [statut, setStatut] = useState(() => activeRdv?.statut || 'planifie');

    // Filtre des créneaux
    const [slotPeriodFilter, setSlotPeriodFilter] = useState('tous');

    // Notifications
    const [notificationEnabled, setNotificationEnabled] = useState(true);
    const [notificationEmail, setNotificationEmail] = useState(() => {
        if (initialRdv?.notificationEmail) return initialRdv.notificationEmail;
        return 'antoine@wheeloh.fr';
    });
    const [notificationDelai, setNotificationDelai] = useState(() => {
        if (initialRdv?.notificationDelaiMinutes) return Number(initialRdv.notificationDelaiMinutes);
        return 15;
    });

    const [testingEmail, setTestingEmail] = useState(false);
    const [testEmailMsg, setTestEmailMsg] = useState(null);
    const [saving, setSaving] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);

    // Disponibilités chargées
    const [disponibilites, setDisponibilites] = useState({});

    useEffect(() => {
        getDisponibilitesSettings().then((res) => {
            if (res) {
                setDisponibilites(res);
                if (!isEditing && res[quiGere]?.defaultEmail) {
                    setNotificationEmail(res[quiGere].defaultEmail);
                }
            }
        });
    }, [quiGere, isEditing]);

    // Fermeture du dropdown client au clic en dehors
    useEffect(() => {
        function handleClickOutside(e) {
            if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target)) {
                setShowClientDropdown(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Client sélectionné actuel
    const selectedClientObj = useMemo(() => {
        if (preselectedClient && preselectedClient.id === clientId) return preselectedClient;
        return clients.find((c) => c.id === clientId) || null;
    }, [clients, clientId, preselectedClient]);

    // Clients filtrés pour la recherche
    const filteredClients = useMemo(() => {
        if (!clientSearch.trim()) return clients.slice(0, 15);
        const q = clientSearch.toLowerCase();
        return clients
            .filter((c) => (c.nom || '').toLowerCase().includes(q) || (c.contactNom || '').toLowerCase().includes(q) || (c.contactPrenom || '').toLowerCase().includes(q))
            .slice(0, 15);
    }, [clients, clientSearch]);

    // Calcul de l'heure de fin
    const heureFin = useMemo(() => {
        return calculateEndTime(heureDebut, dureeMinutes);
    }, [heureDebut, dureeMinutes]);

    // Calcul des créneaux
    const personConfig = disponibilites[quiGere] || null;
    const computedSlots = useMemo(() => {
        if (!date) return [];
        return computeDailySlots(date, quiGere, dureeMinutes, allRdvs, personConfig, initialRdv?.id);
    }, [date, quiGere, dureeMinutes, allRdvs, personConfig, initialRdv?.id]);

    // Filtre matin / après-midi
    const displaySlots = useMemo(() => {
        if (slotPeriodFilter === 'matin') {
            return computedSlots.filter((s) => timeToMinutes(s.time) < 720);
        }
        if (slotPeriodFilter === 'apres-midi') {
            return computedSlots.filter((s) => {
                const m = timeToMinutes(s.time);
                return m >= 720 && m < 1080;
            });
        }
        return computedSlots;
    }, [computedSlots, slotPeriodFilter]);

    // Conflit actif
    const activeConflict = useMemo(() => {
        if (!date || !heureDebut || !heureFin) return null;
        return checkRdvConflict(date, quiGere, heureDebut, heureFin, allRdvs, initialRdv?.id);
    }, [date, quiGere, heureDebut, heureFin, allRdvs, initialRdv?.id]);

    function setDateShortcut(daysOffset) {
        const d = new Date();
        d.setDate(d.getDate() + daysOffset);
        setDate(toISODate(d));
    }

    async function handleTestEmail() {
        if (!notificationEmail) {
            setTestEmailMsg({ ok: false, text: 'Veuillez saisir une adresse email.' });
            return;
        }
        setTestingEmail(true);
        setTestEmailMsg(null);
        try {
            const res = await sendTestEmail(notificationEmail);
            setTestEmailMsg({
                ok: true,
                text: res.simulated ? `Simulation envoyée à ${notificationEmail}` : `Email envoyé avec succès !`,
            });
        } catch (err) {
            setTestEmailMsg({ ok: false, text: `Erreur : ${err.message}` });
        } finally {
            setTestingEmail(false);
        }
    }

    async function handleSubmit(e) {
        e.preventDefault();
        if (!date || !heureDebut || !clientId) return;

        if (activeConflict) {
            const force = window.confirm(
                `Attention : ${quiGere} a déjà un rendez-vous avec "${activeConflict.clientNom}" de ${activeConflict.heureDebut} à ${activeConflict.heureFin}.\n\nSouhaitez-vous forcer l'enregistrement malgré le conflit horaire ?`
            );
            if (!force) return;
        }

        setSaving(true);
        const payload = {
            clientId,
            clientNom: selectedClientObj?.nom || initialRdv?.clientNom || 'Client',
            clientContact: `${selectedClientObj?.contactPrenom || ''} ${selectedClientObj?.contactNom || ''}`.trim(),
            clientTelephone: selectedClientObj?.telephone || '',
            clientEmail: selectedClientObj?.email || '',
            quiGere,
            date,
            heureDebut,
            heureFin,
            dureeMinutes: Number(dureeMinutes),
            type,
            notes: notes.trim(),
            lienVisio: lienVisio.trim(),
            lieu: lieu.trim(),
            statut,
            notificationEmail: notificationEnabled ? notificationEmail.trim() : '',
            notificationDelaiMinutes: Number(notificationDelai),
        };

        try {
            if (isEditing && activeRdv?.id) {
                const updated = await updateRendezVous(activeRdv.id, payload);
                if (onSaved) onSaved(updated);
            } else {
                const created = await createRendezVous(payload);
                if (onSaved) onSaved(created);
            }
            onClose();
        } catch (err) {
            console.error('Erreur sauvegarde RDV:', err);
            alert('Une erreur est survenue lors de l\'enregistrement.');
        } finally {
            setSaving(false);
        }
    }

    async function handleDelete() {
        if (!deleteConfirm) {
            setDeleteConfirm(true);
            return;
        }
        setSaving(true);
        try {
            if (activeRdv?.id) {
                await deleteRendezVous(activeRdv.id);
                if (onDeleted) onDeleted(activeRdv.id);
            }
            onClose();
        } catch (err) {
            console.error('Erreur suppression RDV:', err);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            className="modal-overlay"
            onClick={onClose}
            style={{
                zIndex: 1000,
                background: 'rgba(15, 23, 42, 0.75)',
                backdropFilter: 'blur(5px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
            }}
        >
            <div
                className="modal"
                onClick={(e) => e.stopPropagation()}
                style={{
                    maxWidth: 860,
                    width: '100%',
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    background: 'var(--bg)',
                    borderRadius: 14,
                    border: '1px solid var(--border)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                    overflow: 'hidden',
                }}
            >
                {/* ─── En-tête ─────────────────────────────────────────────── */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '14px 20px',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--bg2)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 8,
                                background: 'rgba(56, 189, 248, 0.12)',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--accent)',
                            }}
                        >
                            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                                <line x1="16" y1="2" x2="16" y2="6"></line>
                                <line x1="8" y1="2" x2="8" y2="6"></line>
                                <line x1="3" y1="10" x2="21" y2="10"></line>
                            </svg>
                        </div>
                        <div>
                            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                                {isEditing ? 'Modifier le rendez-vous' : 'Planifier un nouveau rendez-vous'}
                            </h2>
                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                Agenda partagé • {quiGere}
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn--ghost btn--sm"
                        style={{ width: 30, height: 30, padding: 0, borderRadius: 6, fontSize: 14, color: 'var(--text-muted)' }}
                        title="Fermer"
                    >
                        ✕
                    </button>
                </div>

                {/* ─── Formulaire principal ─────────────────────────────────── */}
                <form
                    onSubmit={handleSubmit}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        overflowY: 'auto',
                    }}
                >
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                            gap: 20,
                            padding: '18px 20px',
                        }}
                    >
                        {/* ─── Colonne Gauche : Détails & Contexte ───────────── */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {/* 1. Sélecteur de client (custom combobox, AUCUN select natif moche) */}
                            <div className="rdv-field-group" ref={clientDropdownRef} style={{ position: 'relative' }}>
                                <label className="rdv-field-label">
                                    <span>Client / Prospect <span style={{ color: 'var(--danger)' }}>*</span></span>
                                    {selectedClientObj && !preselectedClient && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setClientId('');
                                                setShowClientDropdown(true);
                                            }}
                                            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: 10, cursor: 'pointer', fontWeight: 600 }}
                                        >
                                            Changer
                                        </button>
                                    )}
                                </label>

                                {selectedClientObj ? (
                                    <div
                                        style={{
                                            padding: '8px 12px',
                                            background: 'var(--bg3)',
                                            borderRadius: 8,
                                            border: '1px solid var(--border)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div
                                                style={{
                                                    width: 28,
                                                    height: 28,
                                                    borderRadius: '50%',
                                                    background: 'rgba(56, 189, 248, 0.15)',
                                                    color: 'var(--accent)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    fontSize: 12,
                                                    fontWeight: 700,
                                                }}
                                            >
                                                {(selectedClientObj.nom || 'C').charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
                                                    {selectedClientObj.nom || 'Client'}
                                                </div>
                                                {(selectedClientObj.contactPrenom || selectedClientObj.contactNom) && (
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                        {selectedClientObj.contactPrenom || ''} {selectedClientObj.contactNom || ''}
                                                        {selectedClientObj.telephone && ` • ${selectedClientObj.telephone}`}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <span
                                            style={{
                                                fontSize: 10,
                                                fontWeight: 600,
                                                padding: '2px 8px',
                                                borderRadius: 4,
                                                background: 'rgba(56, 189, 248, 0.12)',
                                                color: 'var(--accent)',
                                            }}
                                        >
                                            Sélectionné
                                        </span>
                                    </div>
                                ) : (
                                    <div>
                                        <div style={{ position: 'relative' }}>
                                            <input
                                                type="text"
                                                placeholder="Rechercher par nom de client ou contact..."
                                                value={clientSearch}
                                                onFocus={() => setShowClientDropdown(true)}
                                                onChange={(e) => {
                                                    setClientSearch(e.target.value);
                                                    setShowClientDropdown(true);
                                                }}
                                                className="rdv-input"
                                                style={{ paddingLeft: 30 }}
                                            />
                                            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-light)', pointerEvents: 'none' }}>
                                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <circle cx="11" cy="11" r="8"></circle>
                                                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                                                </svg>
                                            </span>
                                        </div>

                                        {showClientDropdown && (
                                            <div
                                                className="rdv-custom-scrollbar"
                                                style={{
                                                    position: 'absolute',
                                                    top: '100%',
                                                    left: 0,
                                                    right: 0,
                                                    zIndex: 200,
                                                    background: 'var(--bg)',
                                                    border: '1px solid var(--border)',
                                                    borderRadius: 8,
                                                    boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
                                                    maxHeight: 160,
                                                    overflowY: 'auto',
                                                    marginTop: 4,
                                                    padding: 4,
                                                }}
                                            >
                                                {filteredClients.length === 0 ? (
                                                    <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--text-light)', textAlign: 'center' }}>
                                                        Aucun client trouvé
                                                    </div>
                                                ) : (
                                                    filteredClients.map((c) => (
                                                        <div
                                                            key={c.id}
                                                            onClick={() => {
                                                                setClientId(c.id);
                                                                setShowClientDropdown(false);
                                                                setClientSearch('');
                                                            }}
                                                            style={{
                                                                padding: '6px 10px',
                                                                borderRadius: 6,
                                                                cursor: 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'space-between',
                                                                fontSize: 12,
                                                                transition: 'background 0.15s ease',
                                                            }}
                                                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg3)'}
                                                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                                        >
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                <span style={{ fontWeight: 600, color: 'var(--text)' }}>{c.nom}</span>
                                                                {(c.contactPrenom || c.contactNom) && (
                                                                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                                        ({c.contactPrenom || ''} {c.contactNom || ''})
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {c.telephone && (
                                                                <span style={{ fontSize: 10, color: 'var(--text-light)' }}>
                                                                    {c.telephone}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 2. Format du rendez-vous */}
                            <div className="rdv-field-group">
                                <label className="rdv-field-label">Format du rendez-vous</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                                    {[
                                        {
                                            id: 'visio',
                                            label: 'Visio',
                                            icon: (
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                                                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                                                </svg>
                                            ),
                                        },
                                        {
                                            id: 'telephone',
                                            label: 'Appel',
                                            icon: (
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                                                </svg>
                                            ),
                                        },
                                        {
                                            id: 'presentiel',
                                            label: 'Présentiel',
                                            icon: (
                                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                                                    <circle cx="12" cy="10" r="3"></circle>
                                                </svg>
                                            ),
                                        },
                                    ].map((fmt) => {
                                        const isSelected = type === fmt.id;
                                        return (
                                            <button
                                                key={fmt.id}
                                                type="button"
                                                onClick={() => setType(fmt.id)}
                                                style={{
                                                    padding: '9px 10px',
                                                    borderRadius: 8,
                                                    border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                                                    background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg2)',
                                                    color: isSelected ? 'var(--accent)' : 'var(--text)',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 6,
                                                    fontSize: 12,
                                                    fontWeight: isSelected ? 700 : 500,
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                {fmt.icon}
                                                <span>{fmt.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Champ contextuel au format */}
                            {type === 'visio' ? (
                                <div className="rdv-field-group">
                                    <label className="rdv-field-label">Lien de la visioconférence</label>
                                    <div style={{ position: 'relative' }}>
                                        <input
                                            type="url"
                                            placeholder="https://meet.google.com/abc-defg-hij"
                                            value={lienVisio}
                                            onChange={(e) => setLienVisio(e.target.value)}
                                            className="rdv-input"
                                            style={{ paddingRight: lienVisio ? 65 : 12 }}
                                        />
                                        {lienVisio && (
                                            <a
                                                href={lienVisio.startsWith('http') ? lienVisio : `https://${lienVisio}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{
                                                    position: 'absolute',
                                                    right: 6,
                                                    top: '50%',
                                                    transform: 'translateY(-50%)',
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    color: 'var(--accent)',
                                                    background: 'var(--bg3)',
                                                    padding: '2px 6px',
                                                    borderRadius: 4,
                                                }}
                                            >
                                                Ouvrir ↗
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ) : type === 'presentiel' ? (
                                <div className="rdv-field-group">
                                    <label className="rdv-field-label">Lieu du rendez-vous</label>
                                    <input
                                        type="text"
                                        placeholder="Adresse, bureau, salle de réunion..."
                                        value={lieu}
                                        onChange={(e) => setLieu(e.target.value)}
                                        className="rdv-input"
                                    />
                                </div>
                            ) : (
                                <div className="rdv-field-group">
                                    <label className="rdv-field-label">Numéro à joindre</label>
                                    <input
                                        type="text"
                                        readOnly
                                        value={selectedClientObj?.telephone || 'Numéro non renseigné dans la fiche'}
                                        className="rdv-input"
                                        style={{ background: 'var(--bg3)', color: selectedClientObj?.telephone ? 'var(--text)' : 'var(--text-light)' }}
                                    />
                                </div>
                            )}

                            {/* 3. Assigné à */}
                            <div className="rdv-field-group">
                                <label className="rdv-field-label">Assigné à</label>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    {gestionnaires.map((g) => {
                                        const isSelected = quiGere === g;
                                        return (
                                            <button
                                                key={g}
                                                type="button"
                                                onClick={() => setQuiGere(g)}
                                                style={{
                                                    flex: 1,
                                                    padding: '7px 10px',
                                                    borderRadius: 8,
                                                    border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                                                    background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'var(--bg2)',
                                                    color: isSelected ? 'var(--accent)' : 'var(--text)',
                                                    fontSize: 12,
                                                    fontWeight: isSelected ? 700 : 500,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    gap: 6,
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: 18,
                                                        height: 18,
                                                        borderRadius: '50%',
                                                        background: isSelected ? 'var(--accent)' : 'var(--border)',
                                                        color: isSelected ? '#ffffff' : 'var(--text-muted)',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'center',
                                                        fontSize: 9,
                                                        fontWeight: 700,
                                                    }}
                                                >
                                                    {g.charAt(0).toUpperCase()}
                                                </span>
                                                <span>{g}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 4. Notes & Ordre du jour */}
                            <div className="rdv-field-group">
                                <label className="rdv-field-label">Notes & Ordre du jour</label>
                                <textarea
                                    placeholder="Objectifs de l'échange, sujets à aborder, points clés..."
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    rows={2}
                                    className="rdv-textarea"
                                    style={{ height: 60 }}
                                />
                            </div>
                        </div>

                        {/* ─── Colonne Droite : Date, Durée & Créneaux ───────── */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            {/* 1. Date avec raccourcis */}
                            <div className="rdv-field-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label className="rdv-field-label" style={{ margin: 0 }}>
                                        <span>Date <span style={{ color: 'var(--danger)' }}>*</span></span>
                                    </label>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        {[
                                            { label: "Aujourd'hui", offset: 0 },
                                            { label: 'Demain', offset: 1 },
                                            { label: '+1 sem.', offset: 7 },
                                        ].map((btn) => (
                                            <button
                                                key={btn.label}
                                                type="button"
                                                onClick={() => setDateShortcut(btn.offset)}
                                                style={{
                                                    fontSize: 10,
                                                    padding: '2px 7px',
                                                    borderRadius: 4,
                                                    border: '1px solid var(--border)',
                                                    background: 'var(--bg3)',
                                                    color: 'var(--text-muted)',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                {btn.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <DateInput
                                    value={date}
                                    onChange={(e) => setDate(e.target.value)}
                                    required
                                    className="rdv-input"
                                />
                                {date && (
                                    <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600 }}>
                                        {formatFullDateFr(date)}
                                    </div>
                                )}
                            </div>

                            {/* 2. Durée prévue */}
                            <div className="rdv-field-group">
                                <label className="rdv-field-label">Durée du rendez-vous</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 4 }}>
                                    {DURATION_OPTIONS.map((opt) => {
                                        const isSelected = dureeMinutes === opt.value;
                                        return (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setDureeMinutes(opt.value)}
                                                style={{
                                                    padding: '6px 2px',
                                                    borderRadius: 6,
                                                    fontSize: 11,
                                                    fontWeight: isSelected ? 700 : 500,
                                                    border: isSelected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                                                    background: isSelected ? 'var(--accent)' : 'var(--bg2)',
                                                    color: isSelected ? '#ffffff' : 'var(--text)',
                                                    cursor: 'pointer',
                                                    textAlign: 'center',
                                                    transition: 'all 0.15s ease',
                                                }}
                                            >
                                                {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* 3. Créneaux horaires */}
                            <div className="rdv-field-group">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <label className="rdv-field-label" style={{ margin: 0 }}>
                                        <span>Créneau : <strong style={{ color: 'var(--accent)' }}>{heureDebut}</strong> → <strong style={{ color: 'var(--accent)' }}>{heureFin}</strong></span>
                                    </label>
                                    <div style={{ display: 'flex', gap: 4 }}>
                                        {[
                                            { id: 'tous', label: 'Tous' },
                                            { id: 'matin', label: 'Matin' },
                                            { id: 'apres-midi', label: 'Aprem' },
                                        ].map((p) => (
                                            <button
                                                key={p.id}
                                                type="button"
                                                onClick={() => setSlotPeriodFilter(p.id)}
                                                style={{
                                                    fontSize: 10,
                                                    padding: '1px 7px',
                                                    borderRadius: 4,
                                                    border: slotPeriodFilter === p.id ? '1px solid var(--accent)' : '1px solid var(--border)',
                                                    background: slotPeriodFilter === p.id ? 'rgba(56, 189, 248, 0.12)' : 'transparent',
                                                    color: slotPeriodFilter === p.id ? 'var(--accent)' : 'var(--text-light)',
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {p.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Bannière anti-conflit */}
                                {activeConflict && (
                                    <div
                                        style={{
                                            padding: '7px 10px',
                                            borderRadius: 6,
                                            background: 'rgba(239, 68, 68, 0.1)',
                                            border: '1px solid #ef4444',
                                            color: '#ef4444',
                                            fontSize: 11,
                                            fontWeight: 600,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                        }}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                            <circle cx="12" cy="12" r="10"></circle>
                                            <line x1="12" y1="8" x2="12" y2="12"></line>
                                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                                        </svg>
                                        <span>
                                            Conflit : {quiGere} a déjà un RDV ({activeConflict.clientNom}) de {activeConflict.heureDebut} à {activeConflict.heureFin}.
                                        </span>
                                    </div>
                                )}

                                {/* Grille aérée des créneaux */}
                                <div
                                    className="rdv-custom-scrollbar"
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(4, 1fr)',
                                        gap: 5,
                                        maxHeight: 145,
                                        overflowY: 'auto',
                                        padding: 6,
                                        background: 'var(--bg2)',
                                        borderRadius: 8,
                                        border: '1px solid var(--border)',
                                    }}
                                >
                                    {displaySlots.length === 0 ? (
                                        <div style={{ gridColumn: 'span 4', textAlign: 'center', padding: '14px 8px', fontSize: 11, color: 'var(--text-light)' }}>
                                            Aucun créneau dans cette période
                                        </div>
                                    ) : (
                                        displaySlots.map((slot) => {
                                            const isSelected = heureDebut === slot.time;
                                            const isConflict = slot.status === 'conflit';
                                            const isOutOfHours = slot.status === 'hors_dispo';

                                            let slotClass = 'rdv-slot-item';
                                            if (isSelected) slotClass += ' is-selected';
                                            else if (isConflict) slotClass += ' is-conflict';
                                            else if (isOutOfHours) slotClass += ' is-out-of-hours';

                                            return (
                                                <button
                                                    key={slot.time}
                                                    type="button"
                                                    onClick={() => setHeureDebut(slot.time)}
                                                    title={`${slot.time} - ${slot.endTime} : ${slot.reason}`}
                                                    className={slotClass}
                                                >
                                                    <span>{slot.time}</span>
                                                    {isConflict && (
                                                        <span style={{ fontSize: 8, textTransform: 'uppercase', opacity: 0.85 }}>Pris</span>
                                                    )}
                                                </button>
                                            );
                                        })
                                    )}
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10, color: 'var(--text-light)', padding: '0 2px' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} /> Sélectionné
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} /> Déjà pris
                                    </span>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--border)' }} /> Hors dispo
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ─── Section Notifications & Rappels (Barre soignée) ────── */}
                    <div
                        style={{
                            margin: '0 20px 14px',
                            padding: '10px 14px',
                            borderRadius: 8,
                            background: 'var(--bg2)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent)' }}>
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                                    <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                                </svg>
                                <span>Rappel automatique avant le rendez-vous</span>
                            </div>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, cursor: 'pointer' }}>
                                <input
                                    type="checkbox"
                                    checked={notificationEnabled}
                                    onChange={(e) => setNotificationEnabled(e.target.checked)}
                                    style={{ cursor: 'pointer' }}
                                />
                                <span>Activer</span>
                            </label>
                        </div>

                        {notificationEnabled && (
                            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr auto', gap: 8, alignItems: 'center' }}>
                                <div>
                                    <input
                                        type="email"
                                        placeholder="email@domaine.com"
                                        value={notificationEmail}
                                        onChange={(e) => setNotificationEmail(e.target.value)}
                                        className="rdv-input"
                                        style={{ height: 32, fontSize: 11 }}
                                    />
                                </div>
                                <div>
                                    <select
                                        value={notificationDelai}
                                        onChange={(e) => setNotificationDelai(Number(e.target.value))}
                                        className="rdv-select"
                                        style={{ height: 32, fontSize: 11 }}
                                    >
                                        {REMINDER_OPTIONS.map((o) => (
                                            <option key={o.value} value={o.value}>{o.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <button
                                        type="button"
                                        onClick={handleTestEmail}
                                        disabled={testingEmail || !notificationEmail}
                                        className="btn btn--secondary btn--sm"
                                        style={{ height: 32, fontSize: 11, padding: '0 10px', whiteSpace: 'nowrap' }}
                                        title="Tester l'envoi d'email"
                                    >
                                        {testingEmail ? 'Envoi...' : 'Tester'}
                                    </button>
                                </div>
                            </div>
                        )}

                        {testEmailMsg && (
                            <div style={{ fontSize: 11, color: testEmailMsg.ok ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                                {testEmailMsg.text}
                            </div>
                        )}
                    </div>

                    {/* Statut si modification */}
                    {isEditing && (
                        <div style={{ margin: '0 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label className="rdv-field-label" style={{ margin: 0 }}>Statut :</label>
                            <select
                                value={statut}
                                onChange={(e) => setStatut(e.target.value)}
                                className="rdv-select"
                                style={{ width: 180, height: 30, fontSize: 11 }}
                            >
                                <option value="planifie">Planifié (À venir)</option>
                                <option value="termine">Terminé (Effectué)</option>
                                <option value="annule">Annulé</option>
                            </select>
                        </div>
                    )}

                    {/* ─── Pied de modale ─────────────────────────────────────── */}
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '12px 20px',
                            borderTop: '1px solid var(--border)',
                            background: 'var(--bg2)',
                        }}
                    >
                        {isEditing ? (
                            <button
                                type="button"
                                onClick={handleDelete}
                                className="btn btn--danger btn--sm"
                                style={{ fontSize: 12, height: 32 }}
                            >
                                {deleteConfirm ? 'Confirmer la suppression ?' : 'Supprimer'}
                            </button>
                        ) : <div />}

                        <div style={{ display: 'flex', gap: 8 }}>
                            <button
                                type="button"
                                onClick={onClose}
                                className="btn btn--ghost btn--sm"
                                style={{ fontSize: 12, height: 32, padding: '0 14px' }}
                            >
                                Annuler
                            </button>
                            <button
                                type="submit"
                                disabled={saving || !date || !heureDebut || !clientId}
                                className="btn btn--primary btn--sm"
                                style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    height: 32,
                                    padding: '0 16px',
                                    borderRadius: 6,
                                }}
                            >
                                {saving ? 'Enregistrement...' : isEditing ? 'Mettre à jour' : 'Confirmer le rendez-vous'}
                            </button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
}
