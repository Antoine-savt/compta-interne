/**
 * AgendaListView.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Vue Récapitulative / Tableau de tous les Rendez-vous
 * - Recherche instantanée par nom de client, contact ou notes
 * - Filtres par statut (À venir, Terminés, Annulés, Tous)
 * - Actions rapides (Consulter fiche, Modifier, Annuler)
 */
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDate, toISODate } from '../../services/helpers';

export default function AgendaListView({
    rdvs = [],
    clients = [],
    clientsMap = {},
    onSelectRdv,
    onAddRdv,
}) {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [filterTab, setFilterTab] = useState('a_venir'); // 'a_venir' | 'termines' | 'tous'

    const todayStr = toISODate(new Date());

    const filteredRdvs = useMemo(() => {
        let list = [...rdvs];

        // Onglet de filtrage temporel/statut
        if (filterTab === 'a_venir') {
            list = list.filter((r) => r.statut === 'planifie' && r.date >= todayStr);
            list.sort((a, b) => (a.date + a.heureDebut).localeCompare(b.date + b.heureDebut));
        } else if (filterTab === 'termines') {
            list = list.filter((r) => r.statut === 'termine' || (r.statut === 'planifie' && r.date < todayStr));
            list.sort((a, b) => (b.date + b.heureDebut).localeCompare(a.date + a.heureDebut));
        } else {
            list.sort((a, b) => (b.date + b.heureDebut).localeCompare(a.date + a.heureDebut));
        }

        // Recherche texte
        if (search.trim()) {
            const q = search.trim().toLowerCase();
            list = list.filter((r) =>
                (r.clientNom || '').toLowerCase().includes(q) ||
                (r.clientContact || '').toLowerCase().includes(q) ||
                (r.quiGere || '').toLowerCase().includes(q) ||
                (r.notes || '').toLowerCase().includes(q)
            );
        }

        return list;
    }, [rdvs, filterTab, search, todayStr]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
            {/* Barre d'outils (Onglets + Recherche + Bouton Ajouter) */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                {/* Filtres de sous-onglets */}
                <div style={{ display: 'flex', gap: 4, background: 'var(--bg3)', padding: 3, borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                    <button
                        type="button"
                        onClick={() => setFilterTab('a_venir')}
                        className={`btn btn--sm ${filterTab === 'a_venir' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4 }}
                    >
                        À venir
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilterTab('termines')}
                        className={`btn btn--sm ${filterTab === 'termines' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4 }}
                    >
                        Passés / Terminés
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilterTab('tous')}
                        className={`btn btn--sm ${filterTab === 'tous' ? 'btn--primary' : 'btn--ghost'}`}
                        style={{ padding: '4px 12px', fontSize: 12, fontWeight: 600, borderRadius: 4 }}
                    >
                        Tous les RDV ({rdvs.length})
                    </button>
                </div>

                {/* Recherche & Ajout */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="text"
                        placeholder="Rechercher un client ou mot-clé..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="form-control"
                        style={{ width: 240, height: 32, fontSize: 12 }}
                    />
                    <button
                        type="button"
                        onClick={onAddRdv}
                        className="btn btn--primary btn--sm"
                        style={{ height: 32, fontSize: 12, fontWeight: 600 }}
                    >
                        + Nouveau RDV
                    </button>
                </div>
            </div>

            {/* Table des rendez-vous */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Date & Horaire</th>
                                <th>Client / Prospect</th>
                                <th>Type</th>
                                <th>Qui s'en occupe</th>
                                <th>Statut</th>
                                <th>Notes / Lien</th>
                                <th style={{ textAlign: 'center', width: 90 }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRdvs.length === 0 ? (
                                <tr>
                                    <td colSpan={7} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)' }}>
                                        Aucun rendez-vous ne correspond à votre filtre.
                                    </td>
                                </tr>
                            ) : (
                                filteredRdvs.map((rdv) => {
                                    const isCancelled = rdv.statut === 'annule';
                                    const isDone = rdv.statut === 'termine';

                                    return (
                                        <tr key={rdv.id} style={{ opacity: isCancelled ? 0.6 : 1 }}>
                                            {/* Date & Horaire */}
                                            <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                <div>{formatDate(rdv.date)}</div>
                                                <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>
                                                    {rdv.heureDebut} - {rdv.heureFin}
                                                </div>
                                            </td>

                                            {/* Client & Coordonnées */}
                                            <td>
                                                <div style={{ fontWeight: 700 }}>
                                                    {rdv.clientNom}
                                                </div>
                                                {(() => {
                                                    const clientInfo = clientsMap?.[rdv.clientId];
                                                    const contactName =
                                                        rdv.clientContact ||
                                                        (clientInfo ? `${clientInfo.contactPrenom || ''} ${clientInfo.contactNom || ''}`.trim() : '') ||
                                                        clientInfo?.contact ||
                                                        '';
                                                    const telephone = rdv.clientTelephone || clientInfo?.telephone || '';

                                                    if (!contactName && !telephone) return null;

                                                    return (
                                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, flexWrap: 'wrap' }}>
                                                            {contactName && (
                                                                <span>
                                                                    Appel : <strong style={{ color: 'var(--text)' }}>{contactName}</strong>
                                                                </span>
                                                            )}
                                                            {telephone && (
                                                                <a
                                                                    href={`tel:${telephone}`}
                                                                    style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    ({telephone})
                                                                </a>
                                                            )}
                                                        </div>
                                                    );
                                                })()}
                                            </td>

                                            {/* Type */}
                                            <td>
                                                <span
                                                    style={{
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        background: 'var(--bg3)',
                                                        color: 'var(--text)',
                                                    }}
                                                >
                                                    {rdv.type === 'visio' ? 'Visioconférence' : rdv.type === 'telephone' ? 'Téléphone' : 'Présentiel'}
                                                </span>
                                            </td>

                                            {/* Qui gère */}
                                            <td>
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        fontWeight: 700,
                                                        padding: '2px 6px',
                                                        borderRadius: 4,
                                                        background: 'rgba(56, 189, 248, 0.12)',
                                                        color: 'var(--accent)',
                                                    }}
                                                >
                                                    {rdv.quiGere}
                                                </span>
                                            </td>

                                            {/* Statut */}
                                            <td>
                                                <span
                                                    style={{
                                                        fontSize: 11,
                                                        fontWeight: 600,
                                                        padding: '2px 8px',
                                                        borderRadius: 4,
                                                        background: isDone ? '#dcfce7' : isCancelled ? '#fee2e2' : '#eff6ff',
                                                        color: isDone ? '#15803d' : isCancelled ? '#b91c1c' : '#1d4ed8',
                                                    }}
                                                >
                                                    {isDone ? 'Terminé' : isCancelled ? 'Annulé' : 'Planifié'}
                                                </span>
                                            </td>

                                            {/* Notes / Lien */}
                                            <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {rdv.lienVisio && (
                                                    <a
                                                        href={rdv.lienVisio.startsWith('http') ? rdv.lienVisio : `https://${rdv.lienVisio}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: 'var(--accent)', textDecoration: 'none', marginRight: 8, fontWeight: 600, fontSize: 11 }}
                                                    >
                                                        [Lien Visio]
                                                    </a>
                                                )}
                                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                    {rdv.notes || '—'}
                                                </span>
                                            </td>

                                            {/* Actions */}
                                            <td style={{ textAlign: 'center' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                                                    {rdv.clientId && (
                                                        <button
                                                            type="button"
                                                            onClick={() => navigate(`/clients/${rdv.clientId}`)}
                                                            className="btn btn--ghost btn--sm"
                                                            style={{ padding: '2px 6px', fontSize: 10, height: 22 }}
                                                            title="Ouvrir la fiche client"
                                                        >
                                                            Fiche
                                                        </button>
                                                    )}
                                                    <button
                                                        type="button"
                                                        onClick={() => onSelectRdv(rdv)}
                                                        className="btn btn--secondary btn--sm"
                                                        style={{ padding: '2px 6px', fontSize: 10, height: 22, fontWeight: 600 }}
                                                    >
                                                        Modifier
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
