/**
 * AgendaDayView.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Vue Calendrier Journalière Haute Densité
 * - Chronologie complète heure par heure de la journée
 * - Fiches détaillées pour chaque rendez-vous (contact, tel, lien visio, notes)
 * - Détection et alerte explicite de conflit
 * - Actions directes (Fiche client, Modifier, Terminer, Annuler)
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { doIntervalsOverlap } from '../../services/rdvAvailabilityService';

function PhoneSvg({ size = 12, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function AlertSvg({ size = 12, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    );
}

export default function AgendaDayView({
    selectedDate = new Date().toISOString().split('T')[0],
    rdvs = [],
    clients = [],
    clientsMap = {},
    onSelectRdv,
    onAddRdvAtDateAndTime,
}) {
    const navigate = useNavigate();

    // Rendez-vous du jour triés par heure
    const dayRdvs = useMemo(() => {
        return rdvs
            .filter((r) => r.date === selectedDate)
            .sort((a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || ''));
    }, [rdvs, selectedDate]);

    // Formatage de la date en français
    const formattedDateTitle = useMemo(() => {
        const d = new Date(selectedDate + 'T00:00:00');
        return d.toLocaleDateString('fr-FR', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    }, [selectedDate]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
            {/* Titre du jour */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: 'var(--bg3)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, textTransform: 'capitalize', color: 'var(--text)' }}>
                        {formattedDateTitle}
                    </h3>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {dayRdvs.length} rendez-vous planifié{dayRdvs.length > 1 ? 's' : ''} ce jour
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => onAddRdvAtDateAndTime(selectedDate, '09:30')}
                    className="btn btn--primary btn--sm"
                    style={{ fontSize: 12, fontWeight: 600 }}
                >
                    + Ajouter un rendez-vous
                </button>
            </div>

            {/* Liste chronologique détaillée */}
            {dayRdvs.length === 0 ? (
                <div
                    style={{
                        padding: '48px 24px',
                        textAlign: 'center',
                        background: 'var(--bg2)',
                        borderRadius: 8,
                        border: '1px dashed var(--border)',
                        color: 'var(--text-muted)',
                        fontSize: 13,
                    }}
                >
                    <p style={{ margin: '0 0 12px 0' }}>Aucun rendez-vous planifié pour cette journée.</p>
                    <button
                        type="button"
                        onClick={() => onAddRdvAtDateAndTime(selectedDate, '10:00')}
                        className="btn btn--secondary btn--sm"
                    >
                        + Planifier un premier créneau
                    </button>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {dayRdvs.map((rdv) => {
                        // Détection de conflit avec un autre RDV du même jour
                        const conflict = dayRdvs.find(
                            (other) =>
                                other.id !== rdv.id &&
                                other.statut !== 'annule' &&
                                rdv.statut !== 'annule' &&
                                other.quiGere === rdv.quiGere &&
                                doIntervalsOverlap(rdv.heureDebut, rdv.heureFin, other.heureDebut, other.heureFin)
                        );

                        const isCancelled = rdv.statut === 'annule';
                        const isDone = rdv.statut === 'termine';

                        return (
                            <div
                                key={rdv.id}
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 8,
                                    padding: 14,
                                    borderRadius: 8,
                                    background: 'var(--bg)',
                                    border: conflict
                                        ? '1.5px solid #ef4444'
                                        : isCancelled
                                        ? '1px solid var(--border)'
                                        : '1px solid var(--border)',
                                    boxShadow: 'var(--shadow-sm)',
                                    opacity: isCancelled ? 0.6 : 1,
                                    position: 'relative',
                                }}
                            >
                                {/* Alerte Conflit si chevauchement */}
                                {conflict && (
                                    <div
                                        style={{
                                            padding: '4px 8px',
                                            borderRadius: 4,
                                            background: 'rgba(239, 68, 68, 0.12)',
                                            color: '#ef4444',
                                            fontSize: 11,
                                            fontWeight: 700,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                        }}
                                    >
                                        <AlertSvg size={12} />
                                        <span>Conflit horaire :</span>
                                        <span>
                                            Chevauchement avec le RDV de {conflict.clientNom} ({conflict.heureDebut} - {conflict.heureFin})
                                        </span>
                                    </div>
                                )}

                                {/* Ligne supérieure : Horaire, Client, Statut */}
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                        <div
                                            style={{
                                                fontSize: 14,
                                                fontWeight: 800,
                                                color: conflict ? '#ef4444' : 'var(--accent)',
                                                background: 'var(--bg3)',
                                                padding: '4px 8px',
                                                borderRadius: 6,
                                            }}
                                        >
                                            {rdv.heureDebut} - {rdv.heureFin}
                                            <span style={{ fontSize: 10, opacity: 0.75, marginLeft: 4, fontWeight: 500 }}>
                                                ({rdv.dureeMinutes} min)
                                            </span>
                                        </div>

                                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>
                                            {rdv.clientNom}
                                        </div>

                                        {/* Type de RDV */}
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                padding: '2px 8px',
                                                borderRadius: 4,
                                                background: 'var(--bg3)',
                                                color: 'var(--text-muted)',
                                                border: '1px solid var(--border)',
                                            }}
                                        >
                                            {rdv.type === 'visio' ? 'Visioconférence' : rdv.type === 'telephone' ? 'Téléphone' : 'Présentiel'}
                                        </span>
                                    </div>

                                    {/* Qui gère & Statut */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 700,
                                                padding: '3px 8px',
                                                borderRadius: 4,
                                                background: 'rgba(56, 189, 248, 0.12)',
                                                color: 'var(--accent)',
                                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                            }}
                                        >
                                            {rdv.quiGere}
                                        </span>

                                        <span
                                            style={{
                                                fontSize: 11,
                                                fontWeight: 600,
                                                padding: '3px 8px',
                                                borderRadius: 4,
                                                background: isDone ? '#dcfce7' : isCancelled ? '#fee2e2' : '#eff6ff',
                                                color: isDone ? '#15803d' : isCancelled ? '#b91c1c' : '#1d4ed8',
                                            }}
                                        >
                                            {isDone ? 'Terminé' : isCancelled ? 'Annulé' : 'Planifié'}
                                        </span>
                                    </div>
                                </div>

                                {/* Coordonnées & Lien résolus dynamiquement */}
                                {(() => {
                                    const clientInfo = clientsMap?.[rdv.clientId];
                                    const contactName =
                                        rdv.clientContact ||
                                        (clientInfo ? `${clientInfo.contactPrenom || ''} ${clientInfo.contactNom || ''}`.trim() : '') ||
                                        clientInfo?.contact ||
                                        '';
                                    const telephone = rdv.clientTelephone || clientInfo?.telephone || '';
                                    const email = rdv.clientEmail || clientInfo?.email || '';

                                    return (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                                            {contactName && (
                                                <span>
                                                    Contact à appeler : <strong>{contactName}</strong>
                                                </span>
                                            )}
                                            {telephone && (
                                                <a
                                                    href={`tel:${telephone}`}
                                                    style={{
                                                        color: 'var(--accent)',
                                                        textDecoration: 'none',
                                                        fontWeight: 600,
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: 4,
                                                    }}
                                                >
                                                    <PhoneSvg size={12} />
                                                    <span>{telephone}</span>
                                                </a>
                                            )}
                                            {email && (
                                                <a href={`mailto:${email}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
                                                    {email}
                                                </a>
                                            )}
                                            {rdv.lienVisio && (
                                                <a
                                                    href={rdv.lienVisio.startsWith('http') ? rdv.lienVisio : `https://${rdv.lienVisio}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="btn btn--secondary btn--sm"
                                                    style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent)' }}
                                                >
                                                    Rejoindre la visio ↗
                                                </a>
                                            )}
                                            {rdv.lieu && <span>Lieu : {rdv.lieu}</span>}
                                        </div>
                                    );
                                })()}

                                {/* Notes */}
                                {rdv.notes && (
                                    <div style={{ fontSize: 12, background: 'var(--bg2)', padding: '8px 10px', borderRadius: 6, color: 'var(--text)' }}>
                                        {rdv.notes}
                                    </div>
                                )}

                                {/* Boutons d'actions rapides */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4, paddingTop: 6, borderTop: '1px solid var(--border)' }}>
                                    {rdv.clientId && (
                                        <button
                                            type="button"
                                            onClick={() => navigate(`/clients/${rdv.clientId}`)}
                                            className="btn btn--ghost btn--sm"
                                            style={{ fontSize: 11 }}
                                        >
                                            Fiche client
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => onSelectRdv(rdv)}
                                        className="btn btn--secondary btn--sm"
                                        style={{ fontSize: 11, fontWeight: 600 }}
                                    >
                                        Modifier
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
