/**
 * Banque.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Compte bancaire Shine : import des exports CSV et rapprochement de chaque
 * transaction avec la comptabilité (recette client, dépense, CCA, frais...).
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    chargerTransactions, chargerSoldeBanque, importerTransactions, parseShineCSV,
    trouverCorrespondances, majTransaction, mouvement512,
} from '../services/banqueService';
import { getEcrituresActives } from '../services/comptaService';
import { formatMontant, formatDate } from '../services/helpers';
import { ModalRapprochementBancaire, annulerRapprochement } from '../components/ModalRapprochementBancaire';

const FILTRES = [
    { id: 'a_traiter', label: 'À traiter' },
    { id: 'rapprochee', label: 'Rapprochées' },
    { id: 'ignoree', label: 'Ignorées' },
    { id: 'toutes', label: 'Toutes' },
];

const BADGES = {
    a_traiter: { label: 'À traiter', className: 'badge badge--warning' },
    rapprochee: { label: 'Rapprochée', className: 'badge badge--success' },
    ignoree: { label: 'Ignorée', className: 'badge badge--muted' },
};

export default function Banque() {
    const [transactions, setTransactions] = useState([]);
    const [ecrituresBQ, setEcrituresBQ] = useState([]);
    const [solde512, setSolde512] = useState(0);
    const [soldeBanque, setSoldeBanque] = useState(null);
    const [loading, setLoading] = useState(true);
    const [filtre, setFiltre] = useState('a_traiter');
    const [recherche, setRecherche] = useState('');
    const [selection, setSelection] = useState(null);
    const [message, setMessage] = useState(null);
    const [importing, setImporting] = useState(false);
    const [dragActif, setDragActif] = useState(false);
    const fileRef = useRef(null);
    const dragCompteur = useRef(0);

    const loadData = useCallback(async () => {
        try {
            const [txs, ecritures, solde] = await Promise.all([
                chargerTransactions(),
                getEcrituresActives({}, { forceRefresh: true }),
                chargerSoldeBanque(),
            ]);
            setTransactions(txs);
            setEcrituresBQ(ecritures.filter((e) => mouvement512(e) !== 0));
            setSolde512(+ecritures.reduce((s, e) => s + mouvement512(e), 0).toFixed(2));
            setSoldeBanque(solde);
        } catch (err) {
            setMessage({ type: 'danger', text: 'Chargement impossible : ' + err.message });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { loadData(); }, [loadData]);

    async function handleFichier(e) {
        const fichiers = [...(e.target.files || [])];
        e.target.value = '';
        await importerFichiers(fichiers);
    }

    // Glisser-déposer sur toute la page
    const contientFichiers = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    function onDragEnter(e) {
        if (!contientFichiers(e)) return;
        e.preventDefault();
        dragCompteur.current += 1;
        setDragActif(true);
    }
    function onDragLeave(e) {
        if (!contientFichiers(e)) return;
        dragCompteur.current = Math.max(0, dragCompteur.current - 1);
        if (dragCompteur.current === 0) setDragActif(false);
    }
    function onDragOver(e) {
        if (contientFichiers(e)) e.preventDefault();
    }
    async function onDrop(e) {
        if (!contientFichiers(e)) return;
        e.preventDefault();
        dragCompteur.current = 0;
        setDragActif(false);
        const fichiers = [...e.dataTransfer.files];
        const csv = fichiers.filter((f) => /\.csv$/i.test(f.name));
        if (!csv.length) {
            setMessage({ type: 'danger', text: 'Déposez un fichier CSV exporté depuis Shine (BQ_….csv). Les relevés PDF ne peuvent pas être importés.' });
            return;
        }
        await importerFichiers(csv);
    }

    async function importerFichiers(fichiers) {
        if (!fichiers.length) return;
        setImporting(true);
        setMessage(null);
        try {
            let nouvelles = 0;
            let dejaPresentes = 0;
            for (const f of fichiers) {
                const txs = parseShineCSV(await f.text());
                const res = await importerTransactions(txs);
                nouvelles += res.nouvelles;
                dejaPresentes += res.dejaPresentes;
            }
            setMessage({
                type: 'success',
                text: `${nouvelles} nouvelle(s) transaction(s) importée(s)${dejaPresentes ? `, ${dejaPresentes} déjà présente(s) ignorée(s)` : ''}.`,
            });
            setFiltre('a_traiter');
            await loadData();
        } catch (err) {
            setMessage({ type: 'danger', text: err.message });
        } finally {
            setImporting(false);
        }
    }

    // Commissions Shine rattachées à leur transaction d'origine
    const commissionsParParent = useMemo(() => {
        const ids = new Set(transactions.map((t) => t.id));
        const map = {};
        transactions.forEach((t) => {
            if (t.lieeA && ids.has(t.lieeA)) (map[t.lieeA] ||= []).push(t);
        });
        return map;
    }, [transactions]);

    const ecrituresDejaLiees = useMemo(() => new Set(
        transactions.flatMap((t) => t.rapprochement?.ecritureIds || [])
    ), [transactions]);

    function netAvecCommissions(t) {
        const coms = commissionsParParent[t.id] || [];
        return +(t.montant + coms.reduce((s, c) => s + c.montant, 0)).toFixed(2);
    }

    const correspondancesParTx = useMemo(() => {
        const map = {};
        transactions.forEach((t) => {
            if (t.statut === 'a_traiter') {
                map[t.id] = trouverCorrespondances(t, netAvecCommissions(t), ecrituresBQ, ecrituresDejaLiees);
            }
        });
        return map;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactions, ecrituresBQ, ecrituresDejaLiees, commissionsParParent]);

    // Les commissions liées sont affichées sous leur transaction d'origine, pas comme lignes autonomes
    const estCommissionRattachee = (t) => t.lieeA && transactions.some((p) => p.id === t.lieeA);

    const lignes = transactions
        .filter((t) => !estCommissionRattachee(t))
        .filter((t) => filtre === 'toutes' || t.statut === filtre)
        .filter((t) => {
            if (!recherche.trim()) return true;
            const q = recherche.toLowerCase();
            return `${t.libelle} ${t.contrepartie} ${t.commentaire ?? ''} ${t.rapprochement?.label ?? ''}`.toLowerCase().includes(q)
                || String(Math.abs(t.montant)).includes(q.replace(',', '.'));
        });

    const compteurs = useMemo(() => {
        const visibles = transactions.filter((t) => !estCommissionRattachee(t));
        return Object.fromEntries(FILTRES.map((f) => [f.id, f.id === 'toutes' ? visibles.length : visibles.filter((t) => t.statut === f.id).length]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transactions]);

    async function handleAnnuler(t) {
        const r = t.rapprochement;
        const msg = r?.type === 'lien' || r?.type === 'ignoree'
            ? 'Remettre cette transaction « à traiter » ?'
            : `Annuler ce rapprochement ?\n\nLes écritures et documents créés depuis cette transaction (${r?.label}) seront annulés.`;
        if (!window.confirm(msg)) return;
        try {
            await annulerRapprochement(t, commissionsParParent[t.id] || []);
            await loadData();
        } catch (err) {
            setMessage({ type: 'danger', text: 'Annulation impossible : ' + err.message });
        }
    }

    async function marquerTraitee(t) {
        await majTransaction(t.id, { statut: 'rapprochee', rapprochement: { type: 'lien', label: 'Marquée comme déjà en compta', ecritureIds: [] } });
        for (const c of commissionsParParent[t.id] || []) {
            await majTransaction(c.id, { statut: 'rapprochee', rapprochement: { type: 'inclus', label: 'Incluse (déjà en compta)', parentId: t.id } });
        }
        setSelection(null);
        await loadData();
    }

    const ecart = soldeBanque ? +(soldeBanque.soldeBancaire - solde512).toFixed(2) : null;

    return (
        <div
            onDragEnter={onDragEnter}
            onDragLeave={onDragLeave}
            onDragOver={onDragOver}
            onDrop={onDrop}
            style={{ position: 'relative', minHeight: '80vh' }}
        >
            {dragActif && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 900, pointerEvents: 'none',
                    background: 'rgba(37, 99, 235, 0.08)', border: '3px dashed var(--accent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{ background: 'var(--surface)', padding: '20px 28px', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>
                        Déposez l'export CSV Shine pour l'importer
                    </div>
                </div>
            )}

            <div className="page-header">
                <div>
                    <h1>Compte bancaire Shine</h1>
                    <p>Importez vos relevés et rattachez chaque mouvement à la comptabilité en un clic</p>
                </div>
                <div className="page-header__actions">
                    <input ref={fileRef} type="file" accept=".csv,text/csv" multiple hidden onChange={handleFichier} />
                    <button className="btn btn--primary" onClick={() => fileRef.current?.click()} disabled={importing}>
                        {importing ? 'Import en cours...' : 'Importer un export CSV Shine'}
                    </button>
                </div>
            </div>

            {message && <div className={`notice notice--${message.type}`}>{message.text}</div>}

            {/* Soldes */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
                <div className="card" style={{ marginBottom: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Solde Shine{soldeBanque?.date ? ` au ${formatDate(soldeBanque.date)}` : ''}</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{soldeBanque ? formatMontant(soldeBanque.soldeBancaire) : '—'}</div>
                </div>
                <div className="card" style={{ marginBottom: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Solde banque en compta (512)</div>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{formatMontant(solde512)}</div>
                </div>
                <div className="card" style={{ marginBottom: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Écart à expliquer</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: ecart === null ? 'var(--text-muted)' : Math.abs(ecart) < 0.01 ? 'var(--success)' : 'var(--warning)' }}>
                        {ecart === null ? '—' : formatMontant(ecart)}
                    </div>
                    {ecart !== null && Math.abs(ecart) >= 0.01 && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Se réduit à mesure que les transactions sont rapprochées.</div>
                    )}
                </div>
                <div className="card" style={{ marginBottom: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Transactions à traiter</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: compteurs.a_traiter ? 'var(--warning)' : 'var(--success)' }}>{compteurs.a_traiter ?? 0}</div>
                </div>
            </div>

            <div
                onClick={() => !importing && fileRef.current?.click()}
                style={{
                    border: `2px dashed ${dragActif ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-lg)',
                    padding: transactions.length ? '14px 16px' : '36px 16px',
                    textAlign: 'center',
                    cursor: importing ? 'wait' : 'pointer',
                    color: 'var(--text-muted)',
                    fontSize: 13,
                    marginBottom: 20,
                    background: 'var(--bg2)',
                }}
            >
                {importing
                    ? 'Import en cours...'
                    : <>Glissez-déposez ici l'export <strong>BQ_….csv</strong> de Shine, ou <span style={{ color: 'var(--accent)', fontWeight: 600 }}>cliquez pour choisir le fichier</span></>}
            </div>

            {!loading && transactions.length === 0 ? (
                <div className="card" style={{ padding: 32 }}>
                    <h3 style={{ marginTop: 0 }}>Aucune transaction importée</h3>
                    <ol style={{ fontSize: 13, lineHeight: 1.8, color: 'var(--text-muted)', paddingLeft: 18 }}>
                        <li>Dans Shine : Comptabilité → Export comptable, format CSV, sur la période voulue.</li>
                        <li>Cliquez sur « Importer un export CSV Shine » et choisissez le fichier <code>BQ_….csv</code>.</li>
                        <li>Cliquez sur chaque transaction pour indiquer ce que c'est. Les doublons sont ignorés : vous pouvez réimporter sans risque.</li>
                    </ol>
                </div>
            ) : (
                <div className="card" style={{ padding: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '0 16px' }}>
                        <div className="view-tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
                            {FILTRES.map((f) => (
                                <button
                                    key={f.id}
                                    type="button"
                                    className={`view-tab-btn ${filtre === f.id ? 'view-tab-btn--active' : ''}`}
                                    onClick={() => setFiltre(f.id)}
                                >
                                    {f.label}
                                    <span className="view-tab-badge">{compteurs[f.id] ?? 0}</span>
                                </button>
                            ))}
                        </div>
                        <input
                            className="form-input"
                            style={{ maxWidth: 260 }}
                            placeholder="Rechercher (libellé, montant...)"
                            value={recherche}
                            onChange={(e) => setRecherche(e.target.value)}
                        />
                    </div>

                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th style={{ width: 95 }}>Date</th>
                                    <th>Libellé</th>
                                    <th style={{ textAlign: 'right', width: 120 }}>Montant</th>
                                    <th style={{ width: 260 }}>Rapprochement</th>
                                    <th style={{ width: 130 }}></th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>Chargement...</td></tr>
                                )}
                                {!loading && lignes.length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                                        {filtre === 'a_traiter' ? 'Tout est rapproché.' : 'Aucune transaction.'}
                                    </td></tr>
                                )}
                                {lignes.map((t) => {
                                    const coms = commissionsParParent[t.id] || [];
                                    const nbCorresp = correspondancesParTx[t.id]?.length || 0;
                                    const badge = BADGES[t.statut] || BADGES.a_traiter;
                                    const aTraiter = t.statut === 'a_traiter';
                                    return (
                                        <tr
                                            key={t.id}
                                            className={aTraiter ? 'table-row--interactive' : ''}
                                            style={{ cursor: aTraiter ? 'pointer' : 'default' }}
                                            onClick={() => aTraiter && setSelection(t)}
                                        >
                                            <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{formatDate(t.date)}</td>
                                            <td>
                                                <div style={{ fontWeight: 600, fontSize: 13 }}>{t.contrepartie || t.libelle}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                    {t.type}{t.libelle && t.libelle !== t.contrepartie ? ` · ${t.libelle}` : ''}
                                                </div>
                                                {coms.map((c) => (
                                                    <div key={c.id} style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                        + commission {formatMontant(c.debit)} ({c.libelle})
                                                    </div>
                                                ))}
                                                {t.commentaire && (
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', whiteSpace: 'pre-line' }}>
                                                        {t.commentaire.length > 120 ? t.commentaire.slice(0, 120) + '…' : t.commentaire}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap', color: t.montant > 0 ? 'var(--success)' : 'var(--text)' }}>
                                                {t.montant > 0 ? '+' : '−'}{formatMontant(Math.abs(t.montant))}
                                            </td>
                                            <td>
                                                <span className={badge.className}>{badge.label}</span>
                                                {t.rapprochement?.label && (
                                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{t.rapprochement.label}</div>
                                                )}
                                                {aTraiter && nbCorresp > 0 && (
                                                    <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 3 }}>
                                                        Semble déjà saisie en compta
                                                    </div>
                                                )}
                                            </td>
                                            <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                                {aTraiter ? (
                                                    <button className="btn btn--primary btn--sm" onClick={() => setSelection(t)}>Rattacher</button>
                                                ) : (
                                                    <button className="btn btn--ghost btn--sm" onClick={() => handleAnnuler(t)}>
                                                        {t.statut === 'ignoree' ? 'Rétablir' : 'Défaire'}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {selection && (
                <ModalRapprochementBancaire
                    tx={selection}
                    commissions={commissionsParParent[selection.id] || []}
                    correspondances={correspondancesParTx[selection.id] || []}
                    onClose={() => setSelection(null)}
                    onSaved={async () => {
                        setSelection(null);
                        await loadData();
                    }}
                    onMarquerTraitee={() => marquerTraitee(selection)}
                />
            )}
        </div>
    );
}
