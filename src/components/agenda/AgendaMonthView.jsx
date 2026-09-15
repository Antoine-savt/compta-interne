/**
 * AgendaMonthView.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Vue Calendrier Mensuelle complète
 * - Grille classique Lundi à Dimanche
 * - Pastilles de RDV avec code couleur par gestionnaire et format
 * - Détection visuelle immédiate des conflits horaires
 * - Clic sur un jour pour ouvrir la vue jour ou planifier directement
 */
import { useMemo } from 'react';
import { doIntervalsOverlap } from '../../services/rdvAvailabilityService';
import { toISODate } from '../../services/helpers';

const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

const GESTIONNAIRE_COLORS = {
    Antoine: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
    Théophile: { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe' },
    Thomas: { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' },
};

function PhoneSvg({ size = 10, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function VideoSvg({ size = 10, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
    );
}

function PinSvg({ size = 10, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
        </svg>
    );
}

function getPersonColor(personName) {
    return GESTIONNAIRE_COLORS[personName] || { bg: 'var(--bg3)', color: 'var(--text)', border: 'var(--border)' };
}

export default function AgendaMonthView({
    currentDate = new Date(),
    rdvs = [],
    clients = [],
    clientsMap = {},
    onSelectDate,
    onSelectRdv,
    onAddRdvAtDate,
}) {
    // Calcul des jours du mois affiché
    const calendarDays = useMemo(() => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();

        const firstDayOfMonth = new Date(year, month, 1);
        const lastDayOfMonth = new Date(year, month + 1, 0);

        // Jour de début de semaine (0 = Dimanche, 1 = Lundi ...)
        let startDay = firstDayOfMonth.getDay() - 1;
        if (startDay === -1) startDay = 6; // Dimanche devient index 6

        const totalDays = lastDayOfMonth.getDate();

        const days = [];

        // Jours du mois précédent
        const prevMonthLastDay = new Date(year, month, 0).getDate();
        for (let i = startDay - 1; i >= 0; i--) {
            const pDate = new Date(year, month - 1, prevMonthLastDay - i);
            const dateStr = toISODate(pDate);
            days.push({ date: pDate, dateStr, isCurrentMonth: false });
        }

        // Jours du mois courant
        for (let i = 1; i <= totalDays; i++) {
            const cDate = new Date(year, month, i);
            const dateStr = toISODate(cDate);
            days.push({ date: cDate, dateStr, isCurrentMonth: true });
        }

        // Compléter la dernière semaine
        const remaining = 7 - (days.length % 7);
        if (remaining < 7) {
            for (let i = 1; i <= remaining; i++) {
                const nDate = new Date(year, month + 1, i);
                const dateStr = toISODate(nDate);
                days.push({ date: nDate, dateStr, isCurrentMonth: false });
            }
        }

        return days;
    }, [currentDate]);

    // Indexation des RDVs par date
    const rdvsByDate = useMemo(() => {
        const map = {};
        rdvs.forEach((r) => {
            if (!map[r.date]) map[r.date] = [];
            map[r.date].push(r);
        });

        // Trier les RDVs de chaque date par heure de début
        Object.keys(map).forEach((d) => {
            map[d].sort((a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || ''));
        });

        return map;
    }, [rdvs]);

    const todayStr = toISODate(new Date());

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {/* Ligne des jours de la semaine */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                {JOURS_SEMAINE.map((j) => (
                    <div
                        key={j}
                        style={{
                            padding: '8px 6px',
                            textAlign: 'center',
                            fontSize: 12,
                            fontWeight: 700,
                            color: 'var(--text-muted)',
                            textTransform: 'uppercase',
                        }}
                    >
                        {j}
                    </div>
                ))}
            </div>

            {/* Grille des cellules du mois */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--border)', gap: 1 }}>
                {calendarDays.map((dayObj) => {
                    const { dateStr, isCurrentMonth, date } = dayObj;
                    const dayRdvs = rdvsByDate[dateStr] || [];
                    const isToday = dateStr === todayStr;

                    // Détection s'il y a un conflit entre deux RDVs de la même personne ce jour-là
                    let hasConflict = false;
                    for (let i = 0; i < dayRdvs.length; i++) {
                        for (let j = i + 1; j < dayRdvs.length; j++) {
                            const r1 = dayRdvs[i];
                            const r2 = dayRdvs[j];
                            if (
                                r1.statut !== 'annule' &&
                                r2.statut !== 'annule' &&
                                r1.quiGere === r2.quiGere &&
                                doIntervalsOverlap(r1.heureDebut, r1.heureFin, r2.heureDebut, r2.heureFin)
                            ) {
                                hasConflict = true;
                                break;
                            }
                        }
                        if (hasConflict) break;
                    }

                    return (
                        <div
                            key={dateStr}
                            style={{
                                background: isCurrentMonth ? 'var(--bg)' : 'var(--bg2)',
                                minHeight: 110,
                                padding: 6,
                                display: 'flex',
                                flexDirection: 'column',
                                opacity: isCurrentMonth ? 1 : 0.45,
                                position: 'relative',
                            }}
                        >
                            {/* Numéro du jour + bouton + */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span
                                    onClick={() => onSelectDate(dateStr)}
                                    style={{
                                        fontSize: 12,
                                        fontWeight: isToday ? 800 : 600,
                                        color: isToday ? '#ffffff' : 'var(--text)',
                                        background: isToday ? 'var(--accent)' : 'transparent',
                                        width: 22,
                                        height: 22,
                                        borderRadius: '50%',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        cursor: 'pointer',
                                    }}
                                    title="Voir la journée"
                                >
                                    {date.getDate()}
                                </span>

                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    {hasConflict && (
                                        <span
                                            style={{
                                                fontSize: 10,
                                                fontWeight: 800,
                                                color: '#ef4444',
                                                background: 'rgba(239, 68, 68, 0.15)',
                                                padding: '0 4px',
                                                borderRadius: 3,
                                            }}
                                            title="Attention : Conflit de rendez-vous sur cette date !"
                                        >
                                            Conflit
                                        </span>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => onAddRdvAtDate(dateStr)}
                                        className="btn btn--ghost btn--sm"
                                        style={{ padding: '0 4px', height: 18, fontSize: 11, color: 'var(--text-muted)' }}
                                        title={`Planifier un RDV le ${dateStr}`}
                                    >
                                        +
                                    </button>
                                </div>
                            </div>

                            {/* Liste des rendez-vous */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto', maxHeight: 85 }}>
                                {dayRdvs.map((rdv) => {
                                    const col = getPersonColor(rdv.quiGere);
                                    const isCancelled = rdv.statut === 'annule';

                                    const clientInfo = clientsMap?.[rdv.clientId];
                                    const contactName =
                                        rdv.clientContact ||
                                        (clientInfo ? `${clientInfo.contactPrenom || ''} ${clientInfo.contactNom || ''}`.trim() : '') ||
                                        clientInfo?.contact ||
                                        '';
                                    const telephone = rdv.clientTelephone || clientInfo?.telephone || '';

                                    return (
                                        <div
                                            key={rdv.id}
                                            onClick={() => onSelectRdv(rdv)}
                                            style={{
                                                padding: '2px 5px',
                                                borderRadius: 4,
                                                fontSize: 11,
                                                fontWeight: 500,
                                                background: isCancelled ? 'var(--bg3)' : col.bg,
                                                color: isCancelled ? 'var(--text-light)' : col.color,
                                                border: `1px solid ${isCancelled ? 'var(--border)' : col.border}`,
                                                textDecoration: isCancelled ? 'line-through' : 'none',
                                                cursor: 'pointer',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                gap: 4,
                                            }}
                                            title={`${rdv.clientNom} (${rdv.heureDebut} - ${rdv.heureFin})\nContact : ${contactName || 'Sans contact'}\nTéléphone : ${telephone || 'Sans tél'}\nFormat : ${rdv.type}\nGéré par : ${rdv.quiGere}`}
                                        >
                                            <span style={{ fontWeight: 700, fontSize: 10, flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                {rdv.type === 'telephone' ? (
                                                    <PhoneSvg size={9} />
                                                ) : rdv.type === 'visio' ? (
                                                    <VideoSvg size={9} />
                                                ) : (
                                                    <PinSvg size={9} />
                                                )}
                                                <span>{rdv.heureDebut}</span>
                                            </span>
                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, marginLeft: 2, fontWeight: 600 }}>
                                                {rdv.clientNom}
                                            </span>
                                            {contactName && (
                                                <span style={{ fontSize: 9, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 45 }}>
                                                    ({contactName})
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
