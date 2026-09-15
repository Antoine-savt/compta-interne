/**
 * AgendaDisponibilites.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Page de Configuration des Disponibilités de l'Équipe
 * - Plannings récurrents par jour de la semaine (Lundi à Dimanche)
 * - Créneaux multiples par jour (ex: 09h-12h et 14h-18h)
 * - Exceptions ponctuelles (jours fériés, congés ou horaires spécifiques)
 * - Paramètres de notification par défaut (email et délai de rappel)
 * 
 * Contrainte stricte : AUCUN EMOJI. Design soigné, moderne et lisible.
 */
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    getDisponibilitesSettings,
    savePersonDisponibilites,
    DEFAULT_WEEK_SCHEDULE,
    DEFAULT_DISPONIBILITES,
} from '../services/rdvAvailabilityService';
import { getUnifiedGestionnaires } from '../services/crmGestionnairesService';
import ModalManageGestionnaires from '../components/clients/ModalManageGestionnaires';
import { formatDate } from '../services/helpers';
import { DateInput } from '../components/common/DateInput';

const JOURS = [
    { day: 1, label: 'Lundi' },
    { day: 2, label: 'Mardi' },
    { day: 3, label: 'Mercredi' },
    { day: 4, label: 'Jeudi' },
    { day: 5, label: 'Vendredi' },
    { day: 6, label: 'Samedi' },
    { day: 0, label: 'Dimanche' },
];

export default function AgendaDisponibilites() {
    const navigate = useNavigate();

    const [allSettings, setAllSettings] = useState({});
    const [gestionnaires, setGestionnaires] = useState(['Antoine', 'Thomas']);
    const [selectedPerson, setSelectedPerson] = useState('Antoine');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [showManageGestionnaires, setShowManageGestionnaires] = useState(false);

    // Formulaire d'ajout d'exception
    const [exceptionDate, setExceptionDate] = useState('');
    const [exceptionIsOff, setExceptionIsOff] = useState(true);
    const [exceptionStart, setExceptionStart] = useState('10:00');
    const [exceptionEnd, setExceptionEnd] = useState('16:00');

    // Chargement
    async function loadData() {
        setLoading(true);
        try {
            const [settings, gests] = await Promise.all([
                getDisponibilitesSettings(),
                getUnifiedGestionnaires(),
            ]);
            setAllSettings(settings || DEFAULT_DISPONIBILITES);
            if (gests && gests.length > 0) {
                setGestionnaires(gests);
                if (!selectedPerson || !gests.includes(selectedPerson)) {
                    setSelectedPerson(gests[0]);
                }
            }
        } catch (err) {
            console.error('Erreur chargement disponibilités:', err);
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    // Configuration actuelle de la personne sélectionnée
    const currentConfig = allSettings[selectedPerson] || {
        defaultDuration: 30,
        defaultEmail: `${selectedPerson.toLowerCase()}@wheeloh.fr`,
        defaultReminderMinutes: 15,
        recurring: { ...DEFAULT_WEEK_SCHEDULE },
        exceptions: [],
    };

    function updateCurrentConfig(updates) {
        setAllSettings((prev) => ({
            ...prev,
            [selectedPerson]: {
                ...currentConfig,
                ...updates,
            },
        }));
        setSaveSuccess(false);
    }

    // Gestion des créneaux récurrents d'un jour
    function handleAddSlot(dayNum) {
        const recurring = { ...(currentConfig.recurring || DEFAULT_WEEK_SCHEDULE) };
        const daySlots = [...(recurring[dayNum] || [])];
        daySlots.push({ start: '14:00', end: '18:00' });
        recurring[dayNum] = daySlots;
        updateCurrentConfig({ recurring });
    }

    function handleRemoveSlot(dayNum, slotIdx) {
        const recurring = { ...(currentConfig.recurring || DEFAULT_WEEK_SCHEDULE) };
        const daySlots = (recurring[dayNum] || []).filter((_, idx) => idx !== slotIdx);
        recurring[dayNum] = daySlots;
        updateCurrentConfig({ recurring });
    }

    function handleSlotChange(dayNum, slotIdx, field, val) {
        const recurring = { ...(currentConfig.recurring || DEFAULT_WEEK_SCHEDULE) };
        const daySlots = [...(recurring[dayNum] || [])];
        daySlots[slotIdx] = { ...daySlots[slotIdx], [field]: val };
        recurring[dayNum] = daySlots;
        updateCurrentConfig({ recurring });
    }

    // Dupliquer le lundi sur toute la semaine ouvrée (Mardi au Vendredi)
    function handleDuplicateMonday() {
        const recurring = { ...(currentConfig.recurring || DEFAULT_WEEK_SCHEDULE) };
        const mondaySlots = recurring[1] || [];
        for (let d = 2; d <= 5; d++) {
            recurring[d] = JSON.parse(JSON.stringify(mondaySlots));
        }
        updateCurrentConfig({ recurring });
    }

    // Ajouter une exception
    function handleAddException(e) {
        e.preventDefault();
        if (!exceptionDate) return;

        const currentExceptions = [...(currentConfig.exceptions || [])];
        // Remplacer si existe déjà
        const filtered = currentExceptions.filter((ex) => ex.date !== exceptionDate);

        const newException = {
            date: exceptionDate,
            off: exceptionIsOff,
            ranges: exceptionIsOff ? [] : [{ start: exceptionStart, end: exceptionEnd }],
        };

        filtered.push(newException);
        filtered.sort((a, b) => a.date.localeCompare(b.date));

        updateCurrentConfig({ exceptions: filtered });
        setExceptionDate('');
        setExceptionIsOff(true);
    }

    function handleRemoveException(dateStr) {
        const filtered = (currentConfig.exceptions || []).filter((ex) => ex.date !== dateStr);
        updateCurrentConfig({ exceptions: filtered });
    }

    // Sauvegarder
    async function handleSave() {
        setSaving(true);
        setSaveSuccess(false);
        try {
            await savePersonDisponibilites(selectedPerson, currentConfig);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 3500);
        } catch (err) {
            console.error('Erreur sauvegarde disponibilités:', err);
        } finally {
            setSaving(false);
        }
    }

    if (loading) {
        return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Chargement des disponibilités...</div>;
    }

    const recurring = currentConfig.recurring || DEFAULT_WEEK_SCHEDULE;
    const exceptions = currentConfig.exceptions || [];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%', maxWidth: 860, margin: '0 auto' }}>
            {/* Titre & Retour */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                    <button
                        type="button"
                        onClick={() => navigate('/agenda')}
                        className="btn btn--ghost btn--sm"
                        style={{ padding: '2px 8px', marginBottom: 6, fontSize: 11 }}
                    >
                        ← Retour au calendrier
                    </button>
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>
                        Gestion des Disponibilités
                    </h1>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                        Configurez vos horaires de travail récurrents et vos exceptions ponctuelles
                    </div>
                </div>

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="btn btn--primary btn--sm"
                    style={{ fontSize: 13, fontWeight: 700, padding: '8px 18px' }}
                >
                    {saving ? 'Enregistrement...' : saveSuccess ? '✓ Enregistré !' : 'Enregistrer les modifications'}
                </button>
            </div>

            {/* Sélecteur moderne de collaborateur (Synchronisé avec la section Clients) */}
            <div
                style={{
                    background: 'var(--bg2)',
                    borderRadius: 12,
                    padding: '14px 16px',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                            Équipe & Gestionnaires
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-light)', marginTop: 2 }}>
                            Sélectionnez un membre pour configurer ses horaires et exceptions. Synchronisé en temps réel avec la section Clients.
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => setShowManageGestionnaires(true)}
                        className="btn btn--secondary btn--sm"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            padding: '6px 12px',
                            borderRadius: 6,
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                        </svg>
                        Gérer l'équipe
                    </button>
                </div>

                {/* Grille des cartes des collaborateurs */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 10 }}>
                    {gestionnaires.map((person) => {
                        const isSelected = selectedPerson === person;
                        const personConfig = allSettings[person] || {};
                        const exceptionsCount = (personConfig.exceptions || []).length;
                        const initials = person
                            .split(' ')
                            .map((p) => p[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase() || 'U';

                        return (
                            <div
                                key={person}
                                onClick={() => setSelectedPerson(person)}
                                style={{
                                    padding: '10px 12px',
                                    borderRadius: 8,
                                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                                    background: isSelected ? 'rgba(59, 130, 246, 0.08)' : 'var(--bg)',
                                    boxShadow: isSelected ? '0 3px 10px rgba(59, 130, 246, 0.12)' : 'var(--shadow-sm)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 10,
                                }}
                            >
                                {/* Avatar rond avec initiales */}
                                <div
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: '50%',
                                        background: isSelected
                                            ? 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)'
                                            : 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
                                        color: '#ffffff',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: 13,
                                        fontWeight: 800,
                                        letterSpacing: '0.02em',
                                        flexShrink: 0,
                                    }}
                                >
                                    {initials}
                                </div>

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                                        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {person}
                                        </span>
                                        {isSelected && (
                                            <span
                                                style={{
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    color: '#ffffff',
                                                    background: 'var(--accent)',
                                                    padding: '1px 6px',
                                                    borderRadius: 10,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                Actif
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {exceptionsCount > 0 ? `${exceptionsCount} exception${exceptionsCount > 1 ? 's' : ''}` : 'Planning normal'}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Paramètres par défaut de la personne */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                    Paramètres par défaut ({selectedPerson})
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                    <div>
                        <label className="form-label" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Email de réception des rappels :
                        </label>
                        <input
                            type="email"
                            value={currentConfig.defaultEmail || ''}
                            onChange={(e) => updateCurrentConfig({ defaultEmail: e.target.value })}
                            className="form-control"
                            style={{ fontSize: 12, height: 32 }}
                        />
                    </div>

                    <div>
                        <label className="form-label" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Délai de notification par défaut :
                        </label>
                        <select
                            value={currentConfig.defaultReminderMinutes || 15}
                            onChange={(e) => updateCurrentConfig({ defaultReminderMinutes: Number(e.target.value) })}
                            className="form-control"
                            style={{ fontSize: 12, height: 32 }}
                        >
                            <option value={5}>5 minutes avant</option>
                            <option value={10}>10 minutes avant</option>
                            <option value={15}>15 minutes avant</option>
                            <option value={30}>30 minutes avant</option>
                            <option value={60}>1 heure avant</option>
                            <option value={1440}>La veille (24h)</option>
                        </select>
                    </div>

                    <div>
                        <label className="form-label" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            Durée de RDV standard :
                        </label>
                        <select
                            value={currentConfig.defaultDuration || 30}
                            onChange={(e) => updateCurrentConfig({ defaultDuration: Number(e.target.value) })}
                            className="form-control"
                            style={{ fontSize: 12, height: 32 }}
                        >
                            <option value={15}>15 minutes</option>
                            <option value={30}>30 minutes</option>
                            <option value={45}>45 minutes</option>
                            <option value={60}>1 heure</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Planning Récurrent par Jour */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                            Horaires de travail récurrents
                        </h3>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            Les créneaux en dehors de ces plages apparaîtront grisés lors de la planification
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={handleDuplicateMonday}
                        className="btn btn--secondary btn--sm"
                        style={{ fontSize: 11 }}
                        title="Appliquer les plages du lundi du mardi au vendredi"
                    >
                        Copier Lundi sur Mar-Ven
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {JOURS.map(({ day, label }) => {
                        const slots = recurring[day] || [];
                        const isOff = slots.length === 0;

                        return (
                            <div
                                key={day}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '10px 14px',
                                    borderRadius: 6,
                                    background: isOff ? 'var(--bg2)' : 'var(--bg)',
                                    border: '1px solid var(--border)',
                                    flexWrap: 'wrap',
                                    gap: 10,
                                }}
                            >
                                <div style={{ width: 100, fontWeight: 700, fontSize: 13, color: isOff ? 'var(--text-light)' : 'var(--text)' }}>
                                    {label}
                                </div>

                                {/* Liste des créneaux de ce jour */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: 1 }}>
                                    {isOff ? (
                                        <span style={{ fontSize: 12, color: 'var(--text-light)', fontStyle: 'italic' }}>
                                            Non travaillé / Fermé
                                        </span>
                                    ) : (
                                        slots.map((slot, idx) => (
                                            <div
                                                key={idx}
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 4,
                                                    background: 'var(--bg3)',
                                                    padding: '3px 6px',
                                                    borderRadius: 4,
                                                    border: '1px solid var(--border)',
                                                }}
                                            >
                                                <input
                                                    type="time"
                                                    value={slot.start}
                                                    onChange={(e) => handleSlotChange(day, idx, 'start', e.target.value)}
                                                    style={{ border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none' }}
                                                />
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>à</span>
                                                <input
                                                    type="time"
                                                    value={slot.end}
                                                    onChange={(e) => handleSlotChange(day, idx, 'end', e.target.value)}
                                                    style={{ border: 'none', background: 'transparent', fontSize: 12, color: 'var(--text)', outline: 'none' }}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveSlot(day, idx)}
                                                    style={{ border: 'none', background: 'transparent', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}
                                                    title="Supprimer cette plage"
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        ))
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => handleAddSlot(day)}
                                        className="btn btn--ghost btn--sm"
                                        style={{ padding: '2px 8px', fontSize: 11, height: 26 }}
                                    >
                                        + Plage
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Exceptions Ponctuelles (Jours fériés, congés, horaires spéciaux) */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                        Exceptions ponctuelles & Congés
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        Définissez des jours off ou des horaires exceptionnels pour une date précise
                    </div>
                </div>

                {/* Formulaire d'ajout rapide */}
                <form
                    onSubmit={handleAddException}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: 12,
                        background: 'var(--bg3)',
                        borderRadius: 6,
                        border: '1px solid var(--border)',
                        flexWrap: 'wrap',
                    }}
                >
                    <DateInput
                        value={exceptionDate}
                        onChange={(e) => setExceptionDate(e.target.value)}
                        required
                        className="form-control"
                        style={{ width: 150, height: 32, fontSize: 12 }}
                    />

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={exceptionIsOff}
                            onChange={(e) => setExceptionIsOff(e.target.checked)}
                        />
                        <span>Journée off complète (indisponible)</span>
                    </label>

                    {!exceptionIsOff && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                                type="time"
                                value={exceptionStart}
                                onChange={(e) => setExceptionStart(e.target.value)}
                                className="form-control"
                                style={{ width: 85, height: 32, fontSize: 12 }}
                            />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>à</span>
                            <input
                                type="time"
                                value={exceptionEnd}
                                onChange={(e) => setExceptionEnd(e.target.value)}
                                className="form-control"
                                style={{ width: 85, height: 32, fontSize: 12 }}
                            />
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={!exceptionDate}
                        className="btn btn--primary btn--sm"
                        style={{ height: 32, fontSize: 12 }}
                    >
                        + Ajouter l'exception
                    </button>
                </form>

                {/* Liste des exceptions existantes */}
                {exceptions.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-light)', fontStyle: 'italic', padding: '8px 0' }}>
                        Aucune exception enregistrée pour {selectedPerson}.
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {exceptions.map((ex) => (
                            <div
                                key={ex.date}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    padding: '8px 12px',
                                    borderRadius: 6,
                                    background: 'var(--bg)',
                                    border: '1px solid var(--border)',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ fontWeight: 700, fontSize: 13 }}>{formatDate(ex.date)}</span>
                                    <span
                                        style={{
                                            fontSize: 11,
                                            fontWeight: 600,
                                            padding: '2px 8px',
                                            borderRadius: 4,
                                            background: ex.off ? 'rgba(239, 68, 68, 0.1)' : 'rgba(56, 189, 248, 0.1)',
                                            color: ex.off ? '#ef4444' : 'var(--accent)',
                                        }}
                                    >
                                        {ex.off
                                            ? 'Journée off (indisponible)'
                                            : `Horaires spéciaux : ${ex.ranges?.map((r) => `${r.start}-${r.end}`).join(', ')}`}
                                    </span>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => handleRemoveException(ex.date)}
                                    className="btn btn--ghost btn--sm"
                                    style={{ color: '#ef4444', padding: '2px 6px', fontSize: 11 }}
                                >
                                    Supprimer
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modale de gestion des membres de l'équipe */}
            {showManageGestionnaires && (
                <ModalManageGestionnaires
                    gestionnaires={gestionnaires}
                    onClose={() => setShowManageGestionnaires(false)}
                    onSave={async () => {
                        const unified = await getUnifiedGestionnaires();
                        setGestionnaires(unified);
                    }}
                />
            )}
        </div>
    );
}
