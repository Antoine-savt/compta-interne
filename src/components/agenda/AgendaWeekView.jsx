/**
 * AgendaWeekView.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Vue Calendrier Hebdomadaire Haute Densité (Grille horaire 08:00 à 20:00)
 * - Cartes enrichies : Nom client, contact à appeler, numéro de téléphone, format avec SVG, gestionnaire
 * - Pastilles de rappel cliquables dans l'en-tête de chaque jour (accès direct aux RDVs de l'après-midi)
 * - Défilement automatique au premier RDV de la semaine
 * - Ligne indicatrice de l'heure actuelle
 * - Détection et alerte visuelle de conflits horaires
 * 
 * Contrainte stricte : STRICTEMENT AUCUN EMOJI. Icônes SVG vectorielles uniquement.
 */
import { useMemo, useEffect, useRef } from 'react';
import { timeToMinutes, doIntervalsOverlap } from '../../services/rdvAvailabilityService';
import { toISODate } from '../../services/helpers';

const START_HOUR = 8;
const END_HOUR = 20;
const TOTAL_MINUTES = (END_HOUR - START_HOUR) * 60; // 720 minutes

const GESTIONNAIRE_COLORS = {
    Antoine: { bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe', dot: '#3b82f6' },
    Théophile: { bg: '#f5f3ff', color: '#6d28d9', border: '#ddd6fe', dot: '#8b5cf6' },
    Thomas: { bg: '#ecfdf5', color: '#047857', border: '#a7f3d0', dot: '#10b981' },
};

function getPersonColor(personName) {
    return GESTIONNAIRE_COLORS[personName] || {
        bg: 'var(--bg3)',
        color: 'var(--text)',
        border: 'var(--border)',
        dot: 'var(--text-muted)',
    };
}

// ─── Icônes SVG vectorielles ──────────────────────────────────────────────────
function PhoneSvg({ size = 11, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
    );
}

function VideoSvg({ size = 11, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
        </svg>
    );
}

function PinSvg({ size = 11, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
            <circle cx="12" cy="10" r="3" />
        </svg>
    );
}

function AlertSvg({ size = 11, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
    );
}

export default function AgendaWeekView({
    currentDate = new Date(),
    rdvs = [],
    clients = [],
    clientsMap = {},
    onSelectRdv,
    onAddRdvAtDateAndTime,
}) {
    const gridContainerRef = useRef(null);

    // Calcul des 7 jours de la semaine courante (du Lundi au Dimanche)
    const weekDays = useMemo(() => {
        const d = new Date(currentDate);
        const day = d.getDay();
        const diffToMonday = day === 0 ? -6 : 1 - day; // Lundi comme premier jour
        const monday = new Date(d);
        monday.setDate(d.getDate() + diffToMonday);

        const days = [];
        for (let i = 0; i < 7; i++) {
            const nextDay = new Date(monday);
            nextDay.setDate(monday.getDate() + i);
            const dateStr = toISODate(nextDay);
            days.push({
                date: nextDay,
                dateStr,
                dayName: nextDay.toLocaleDateString('fr-FR', { weekday: 'short' }),
                dayNumber: nextDay.getDate(),
                monthName: nextDay.toLocaleDateString('fr-FR', { month: 'short' }),
            });
        }
        return days;
    }, [currentDate]);

    // Heures de la grille (08:00, 09:00 ... 20:00)
    const hours = useMemo(() => {
        const list = [];
        for (let h = START_HOUR; h <= END_HOUR; h++) {
            list.push(`${String(h).padStart(2, '0')}:00`);
        }
        return list;
    }, []);

    // Indexer les RDV par date
    const rdvsByDate = useMemo(() => {
        const map = {};
        weekDays.forEach((wd) => {
            const dayList = rdvs.filter((r) => r.date === wd.dateStr);
            dayList.sort((a, b) => (a.heureDebut || '').localeCompare(b.heureDebut || ''));
            map[wd.dateStr] = dayList;
        });
        return map;
    }, [weekDays, rdvs]);

    const todayStr = new Date().toISOString().split('T')[0];

    // Défilement automatique au premier RDV de la semaine ou à 08:30 au montage
    useEffect(() => {
        if (!gridContainerRef.current) return;
        const allWeekRdvs = weekDays.flatMap((wd) => rdvsByDate[wd.dateStr] || []);
        if (allWeekRdvs.length > 0) {
            // Trouver l'horaire le plus tôt
            const earliestMin = Math.min(...allWeekRdvs.map((r) => timeToMinutes(r.heureDebut || '10:00')));
            const scrollOffset = Math.max(0, ((earliestMin - START_HOUR * 60) / TOTAL_MINUTES) * 600 - 30);
            gridContainerRef.current.scrollTop = scrollOffset;
        } else {
            // Défilement par défaut vers 09:00
            gridContainerRef.current.scrollTop = 50;
        }
    }, [currentDate, rdvsByDate]);

    // Défilement fluide vers un RDV spécifique
    function scrollToRdv(rdvId) {
        const el = document.getElementById(`rdv-card-${rdvId}`);
        if (el && gridContainerRef.current) {
            const containerTop = gridContainerRef.current.getBoundingClientRect().top;
            const elTop = el.getBoundingClientRect().top;
            gridContainerRef.current.scrollBy({ top: elTop - containerTop - 40, behavior: 'smooth' });
            el.style.transform = 'scale(1.02)';
            el.style.boxShadow = '0 0 0 2px var(--accent)';
            setTimeout(() => {
                el.style.transform = 'none';
                el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.1)';
            }, 1200);
        }
    }

    // Clic sur la grille pour créer à une heure approximative
    function handleGridClick(dateStr, e) {
        const rect = e.currentTarget.getBoundingClientRect();
        const clickY = e.clientY - rect.top;
        const percent = Math.max(0, Math.min(1, clickY / rect.height));
        const clickedMinutes = Math.floor((percent * TOTAL_MINUTES) / 15) * 15; // Arrondi au quart d'heure
        const totalMin = START_HOUR * 60 + clickedMinutes;
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        onAddRdvAtDateAndTime(dateStr, timeStr);
    }

    // Calcul de l'indicateur d'heure courante
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const isNowInGrid = nowMin >= START_HOUR * 60 && nowMin <= END_HOUR * 60;
    const nowTopPercent = isNowInGrid ? ((nowMin - START_HOUR * 60) / TOTAL_MINUTES) * 100 : null;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg)' }}>
            {/* En-tête des jours avec pastilles cliquables de résumé */}
            <div style={{ display: 'grid', gridTemplateColumns: '54px repeat(7, 1fr)', background: 'var(--bg3)', borderBottom: '1px solid var(--border)' }}>
                <div style={{ padding: '8px 4px', borderRight: '1px solid var(--border)', fontSize: 11, color: 'var(--text-light)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>
                    Heure
                </div>
                {weekDays.map((wd) => {
                    const isToday = wd.dateStr === todayStr;
                    const dayRdvs = rdvsByDate[wd.dateStr] || [];

                    return (
                        <div
                            key={wd.dateStr}
                            style={{
                                padding: '8px 4px 6px 4px',
                                textAlign: 'center',
                                borderRight: '1px solid var(--border)',
                                background: isToday ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                minHeight: 62,
                            }}
                        >
                            <div style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--accent)' : 'var(--text-muted)', textTransform: 'capitalize' }}>
                                {wd.dayName}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--accent)' : 'var(--text)' }}>
                                {wd.dayNumber} {wd.monthName}
                            </div>

                            {/* Pastilles de RDV cliquables sous chaque jour */}
                            {dayRdvs.length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center', marginTop: 4, width: '100%' }}>
                                    {dayRdvs.map((r) => {
                                        const isCancelled = r.statut === 'annule';
                                        return (
                                            <button
                                                key={r.id}
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    scrollToRdv(r.id);
                                                }}
                                                style={{
                                                    padding: '1px 5px',
                                                    borderRadius: 10,
                                                    fontSize: 10,
                                                    fontWeight: 700,
                                                    background: isCancelled ? 'var(--bg3)' : r.type === 'visio' ? 'rgba(59, 130, 246, 0.16)' : r.type === 'telephone' ? 'rgba(16, 185, 129, 0.16)' : 'rgba(139, 92, 246, 0.16)',
                                                    color: isCancelled ? 'var(--text-light)' : r.type === 'visio' ? '#2563eb' : r.type === 'telephone' ? '#059669' : '#7c3aed',
                                                    border: '1px solid rgba(0,0,0,0.06)',
                                                    cursor: 'pointer',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 3,
                                                    maxWidth: '100%',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title={`Aller au RDV de ${r.heureDebut} avec ${r.clientNom}`}
                                            >
                                                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
                                                <span>{r.heureDebut}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Corps de la grille horaire avec défilement */}
            <div
                ref={gridContainerRef}
                style={{
                    display: 'grid',
                    gridTemplateColumns: '54px repeat(7, 1fr)',
                    height: 620,
                    overflowY: 'auto',
                    position: 'relative',
                }}
            >
                {/* Colonne des heures */}
                <div style={{ display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg2)', userSelect: 'none' }}>
                    {hours.map((h, idx) => (
                        <div
                            key={h}
                            style={{
                                height: 50,
                                fontSize: 10,
                                fontWeight: 600,
                                color: 'var(--text-light)',
                                textAlign: 'center',
                                paddingRight: 4,
                                paddingTop: 2,
                                borderBottom: idx < hours.length - 1 ? '1px solid var(--border)' : 'none',
                                boxSizing: 'border-box',
                            }}
                        >
                            {h}
                        </div>
                    ))}
                </div>

                {/* Colonnes des 7 jours */}
                {weekDays.map((wd) => {
                    const dayRdvs = rdvsByDate[wd.dateStr] || [];
                    const isToday = wd.dateStr === todayStr;

                    return (
                        <div
                            key={wd.dateStr}
                            onClick={(e) => handleGridClick(wd.dateStr, e)}
                            style={{
                                position: 'relative',
                                height: 50 * (hours.length - 1),
                                borderRight: '1px solid var(--border)',
                                background: isToday ? 'rgba(56, 189, 248, 0.02)' : 'transparent',
                                cursor: 'pointer',
                            }}
                            title={`Cliquer pour planifier un RDV le ${wd.dateStr}`}
                        >
                            {/* Lignes horaires de fond */}
                            {hours.slice(0, -1).map((h, idx) => (
                                <div
                                    key={h}
                                    style={{
                                        position: 'absolute',
                                        top: idx * 50,
                                        left: 0,
                                        right: 0,
                                        height: 50,
                                        borderBottom: '1px dashed var(--border)',
                                        pointerEvents: 'none',
                                        boxSizing: 'border-box',
                                    }}
                                />
                            ))}

                            {/* Ligne indicatrice heure actuelle si aujourd'hui */}
                            {isToday && nowTopPercent !== null && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        top: `${nowTopPercent}%`,
                                        left: 0,
                                        right: 0,
                                        height: 2,
                                        background: '#ef4444',
                                        zIndex: 8,
                                        pointerEvents: 'none',
                                    }}
                                >
                                    <div
                                        style={{
                                            position: 'absolute',
                                            left: -4,
                                            top: -3,
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            background: '#ef4444',
                                        }}
                                    />
                                </div>
                            )}

                            {/* Blocs de RDVs positionnés & enrichis */}
                            {dayRdvs.map((rdv) => {
                                const startMin = timeToMinutes(rdv.heureDebut || '09:00') - START_HOUR * 60;
                                const duration = Number(rdv.dureeMinutes) || 30;
                                const topPercent = Math.max(0, (startMin / TOTAL_MINUTES) * 100);
                                const heightPercent = (duration / TOTAL_MINUTES) * 100;

                                // Détection si ce RDV est en conflit avec un autre ce même jour
                                const hasConflict = dayRdvs.some(
                                    (other) =>
                                        other.id !== rdv.id &&
                                        other.statut !== 'annule' &&
                                        rdv.statut !== 'annule' &&
                                        other.quiGere === rdv.quiGere &&
                                        doIntervalsOverlap(rdv.heureDebut, rdv.heureFin, other.heureDebut, other.heureFin)
                                );

                                const col = getPersonColor(rdv.quiGere);
                                const isCancelled = rdv.statut === 'annule';

                                // Résolution dynamique des coordonnées du client si absentes du rdv
                                const clientInfo = clientsMap?.[rdv.clientId];
                                const contactName =
                                    rdv.clientContact ||
                                    (clientInfo ? `${clientInfo.contactPrenom || ''} ${clientInfo.contactNom || ''}`.trim() : '') ||
                                    clientInfo?.contact ||
                                    '';
                                const telephone = rdv.clientTelephone || clientInfo?.telephone || '';

                                return (
                                    <div
                                        id={`rdv-card-${rdv.id}`}
                                        key={rdv.id}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onSelectRdv(rdv);
                                        }}
                                        style={{
                                            position: 'absolute',
                                            top: `${topPercent}%`,
                                            height: `max(${heightPercent}%, 64px)`,
                                            left: 2,
                                            right: 2,
                                            borderRadius: 6,
                                            padding: '4px 6px',
                                            fontSize: 11,
                                            background: hasConflict
                                                ? 'rgba(239, 68, 68, 0.18)'
                                                : isCancelled
                                                ? 'var(--bg3)'
                                                : col.bg,
                                            color: hasConflict ? '#ef4444' : isCancelled ? 'var(--text-light)' : col.color,
                                            border: `1.5px solid ${hasConflict ? '#ef4444' : isCancelled ? 'var(--border)' : col.border}`,
                                            textDecoration: isCancelled ? 'line-through' : 'none',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                                            zIndex: hasConflict ? 5 : 3,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            justifyContent: 'space-between',
                                            overflow: 'hidden',
                                            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                                        }}
                                        title={`${rdv.clientNom} (${rdv.heureDebut} - ${rdv.heureFin})\nContact : ${contactName || 'Sans contact'}\nTéléphone : ${telephone || 'Sans tél'}\nFormat : ${rdv.type}\nGéré par : ${rdv.quiGere}`}
                                    >
                                        <div>
                                            {/* Ligne 1 : Horaires & Badge de Format avec Icône SVG */}
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, marginBottom: 2 }}>
                                                <span style={{ fontWeight: 800, fontSize: 10, letterSpacing: '-0.02em' }}>
                                                    {rdv.heureDebut} - {rdv.heureFin}
                                                </span>

                                                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    {/* Badge du format du RDV */}
                                                    <span
                                                        style={{
                                                            display: 'inline-flex',
                                                            alignItems: 'center',
                                                            gap: 3,
                                                            fontSize: 9,
                                                            fontWeight: 700,
                                                            padding: '1px 4px',
                                                            borderRadius: 3,
                                                            background: 'rgba(0, 0, 0, 0.06)',
                                                        }}
                                                    >
                                                        {rdv.type === 'telephone' ? (
                                                            <>
                                                                <PhoneSvg size={9} />
                                                                <span>Appel</span>
                                                            </>
                                                        ) : rdv.type === 'visio' ? (
                                                            <>
                                                                <VideoSvg size={9} />
                                                                <span>Visio</span>
                                                            </>
                                                        ) : (
                                                            <>
                                                                <PinSvg size={9} />
                                                                <span>Sur place</span>
                                                            </>
                                                        )}
                                                    </span>

                                                    {hasConflict && (
                                                        <span
                                                            style={{
                                                                background: '#ef4444',
                                                                color: '#fff',
                                                                fontSize: 9,
                                                                padding: '1px 4px',
                                                                borderRadius: 2,
                                                                fontWeight: 700,
                                                                display: 'inline-flex',
                                                                alignItems: 'center',
                                                                gap: 2,
                                                            }}
                                                        >
                                                            <AlertSvg size={9} color="#fff" />
                                                            <span>Conflit</span>
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Ligne 2 : Nom du Client / Établissement */}
                                            <div
                                                style={{
                                                    fontWeight: 750,
                                                    fontSize: 11,
                                                    lineHeight: 1.2,
                                                    color: 'var(--text)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                }}
                                            >
                                                {rdv.clientNom}
                                            </div>

                                            {/* Ligne 3 : Qui sera appelé & À quel numéro */}
                                            <div
                                                style={{
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    marginTop: 2,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 3,
                                                    opacity: 0.9,
                                                    color: 'var(--text)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                }}
                                            >
                                                {rdv.type === 'telephone' ? (
                                                    <>
                                                        <PhoneSvg size={10} color="var(--accent)" />
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {contactName ? `${contactName} : ` : ''}
                                                            <span style={{ fontWeight: 700, color: 'var(--accent)' }}>
                                                                {telephone || 'Sans tél'}
                                                            </span>
                                                        </span>
                                                    </>
                                                ) : rdv.type === 'visio' ? (
                                                    <>
                                                        <VideoSvg size={10} color="#2563eb" />
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {contactName ? `Avec ${contactName}` : 'Lien visio'}
                                                            {telephone ? ` • ${telephone}` : ''}
                                                        </span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <PinSvg size={10} color="#7c3aed" />
                                                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {contactName ? `Avec ${contactName}` : rdv.lieu || 'Présentiel'}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>

                                        {/* Ligne 4 (Pied de carte) : Gestionnaire & statut */}
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                fontSize: 9,
                                                fontWeight: 600,
                                                marginTop: 2,
                                                opacity: 0.8,
                                            }}
                                        >
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: col.dot }} />
                                                <span>{rdv.quiGere}</span>
                                            </span>

                                            {rdv.notes && (
                                                <span
                                                    style={{
                                                        maxWidth: 60,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        fontSize: 9,
                                                        color: 'var(--text-light)',
                                                    }}
                                                >
                                                    {rdv.notes}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
