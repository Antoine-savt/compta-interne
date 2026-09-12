/**
 * FicheClient.jsx — v2
 * + Coût par client (dépenses rattachées)
 * + Marge brute (%)
 * + Projections 1 / 2 / 3 ans depuis le MRR
 * + Fix : champ coutMensuelEstime
 */
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    doc, getDoc, getDocs, collection, query, where,
    orderBy, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant, formatDate } from '../services/helpers';

function Spinner() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)', padding: '32px 0' }}>
            <div style={{
                width: 20, height: 20, borderRadius: '50%',
                border: '2px solid var(--border)',
                borderTopColor: 'var(--accent)',
                animation: 'spin 0.7s linear infinite',
                flexShrink: 0,
            }} />
            Chargement...
        </div>
    );
}

export default function FicheClient() {
    const { clientId } = useParams();
    const navigate = useNavigate();

    const [client, setClient] = useState(null);
    const [categories, setCategories] = useState([]);
    const [versements, setVersements] = useState([]);  // versements Stripe legacy
    const [facturations, setFacturations] = useState([]);  // nouvelles facturations
    const [depenses, setDepenses] = useState([]);  // dépenses liées
    const [loading, setLoading] = useState(true);
    const [edit, setEdit] = useState(false);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        async function load() {
            const [cliSnap, catSnap, versSnap, factSnap, depSnap] = await Promise.all([
                getDoc(doc(db, 'clients', clientId)),
                getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
                getDocs(query(collection(db, 'versementsStripe'), where('clientId', '==', clientId), orderBy('dateVirement', 'desc'))),
                getDocs(query(collection(db, 'facturations'), where('clientId', '==', clientId), orderBy('date', 'desc'))),
                getDocs(query(collection(db, 'depenses'), where('clientId', '==', clientId))),
            ]);
            if (!cliSnap.exists()) { navigate('/clients'); return; }
            const cli = { id: cliSnap.id, ...cliSnap.data() };
            setClient(cli);
            setForm(cli);
            setCategories(catSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setVersements(versSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setFacturations(factSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setDepenses(depSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
            setLoading(false);
        }
        load();
    }, [clientId, navigate]);

    // ─── Métriques ────────────────────────────────────────────────────────────
    const totalEncaisseStripe = versements.reduce((s, v) => s + (v.montantBrut ?? 0), 0);
    const totalFacture = facturations.reduce((s, f) => s + (f.totalFacture ?? 0), 0);
    const totalRevenu = totalEncaisseStripe + totalFacture;

    const totalDepenses = depenses.reduce((s, d) => s + (d.montantTTC ?? d.montant ?? 0), 0);

    const marge = totalRevenu > 0 ? ((totalRevenu - totalDepenses) / totalRevenu) * 100 : null;

    // MRR : depuis les facturations ou manuel
    const mrrFacture = facturations.reduce((s, f) => s + (f.mrr ?? 0), 0);
    const mrrAbo = versements
        .filter((v) => v.recurrence?.type === 'recurrent' && v.abonnementMensuelEstime)
        .reduce((max, v) => Math.max(max, v.abonnementMensuelEstime), 0);
    const mrr = mrrFacture || mrrAbo || parseFloat(client?.abonnementMensuelManuel) || 0;

    async function handleSave() {
        setSaving(true);
        await updateDoc(doc(db, 'clients', clientId), {
            nom: form.nom ?? '',
            prenom: form.prenom ?? '',
            email: form.email ?? '',
            telephone: form.telephone ?? '',
            adresse: form.adresse ?? '',
            prestations: form.prestations ?? '',
            categorieId: form.categorieId ?? null,
            categorieNom: categories.find((c) => c.id === form.categorieId)?.nom ?? null,
            abonnementMensuelManuel: parseFloat(form.abonnementMensuelManuel) || 0,
            coutMensuelEstime: parseFloat(form.coutMensuelEstime) || 0,
            updatedAt: serverTimestamp(),
        });
        setClient((prev) => ({ ...prev, ...form }));
        setEdit(false);
        setSaving(false);
    }

    if (loading) return <Spinner />;

    const cat = categories.find((c) => c.id === client.categorieId);

    return (
        <div>
            <div className="page-header">
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <button className="btn btn--ghost btn--sm" onClick={() => navigate('/clients')}>Retour</button>
                    <div>
                        <h1 style={{ margin: 0 }}>{client.nom} {client.prenom}</h1>
                        {cat && (
                            <span className="badge" style={{ background: cat.couleur + '22', color: cat.couleur, border: `1px solid ${cat.couleur}55`, marginTop: 4 }}>
                                {cat.nom}
                            </span>
                        )}
                    </div>
                </div>
                <div className="page-header__actions">
                    {!edit && <button className="btn btn--ghost" onClick={() => setEdit(true)}>Modifier</button>}
                </div>
            </div>

            {/* ─── Métriques financières ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
                <MetricCard label="Revenus totaux" value={formatMontant(totalRevenu)} accent="var(--success)" />
                <MetricCard label="Dépenses liées" value={formatMontant(totalDepenses)} accent={totalDepenses > 0 ? 'var(--danger)' : 'var(--text-muted)'} hint="Dépenses rattachées à ce client" />
                <MetricCard
                    label="Marge brute"
                    value={marge !== null ? `${marge.toFixed(1)} %` : '—'}
                    accent={marge === null ? 'var(--text-muted)' : marge >= 50 ? 'var(--success)' : marge >= 20 ? 'var(--warning)' : 'var(--danger)'}
                />
                <MetricCard label="MRR estimé" value={mrr > 0 ? formatMontant(mrr) + ' /mois' : '—'} accent="var(--accent)" />
            </div>

            {/* ─── Projections ── */}
            {mrr > 0 && (
                <div className="card" style={{ padding: '14px 20px', marginBottom: 16 }}>
                    <div className="card__title" style={{ marginBottom: 10 }}>Projections des revenus récurrents</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                        <ProjBox label="1 an" revenu={mrr * 12} depense={(client.coutMensuelEstime ?? 0) * 12} />
                        <ProjBox label="2 ans" revenu={mrr * 24} depense={(client.coutMensuelEstime ?? 0) * 24} />
                        <ProjBox label="3 ans" revenu={mrr * 36} depense={(client.coutMensuelEstime ?? 0) * 36} />
                    </div>
                </div>
            )}

            {/* ─── Infos client ── */}
            <div className="card">
                <div className="card__title">Informations</div>
                {edit ? (
                    <div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Nom</label>
                                <input type="text" className="form-input" value={form.nom ?? ''} onChange={(e) => setForm((f) => ({ ...f, nom: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Prénom</label>
                                <input type="text" className="form-input" value={form.prenom ?? ''} onChange={(e) => setForm((f) => ({ ...f, prenom: e.target.value }))} />
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group">
                                <label className="form-label">Email</label>
                                <input type="email" className="form-input" value={form.email ?? ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Téléphone</label>
                                <input type="tel" className="form-input" value={form.telephone ?? ''} onChange={(e) => setForm((f) => ({ ...f, telephone: e.target.value }))} />
                            </div>
                        </div>
                        <div className="form-group">
                            <label className="form-label">Adresse</label>
                            <textarea className="form-textarea" value={form.adresse ?? ''} onChange={(e) => setForm((f) => ({ ...f, adresse: e.target.value }))} rows={2} />
                        </div>
                        <div className="form-group">
                            <label className="form-label">Prestations</label>
                            <textarea className="form-textarea" value={form.prestations ?? ''} onChange={(e) => setForm((f) => ({ ...f, prestations: e.target.value }))} rows={2} />
                        </div>
                        <div className="form-row form-row--3">
                            <div className="form-group">
                                <label className="form-label">Catégorie</label>
                                <select className="form-select" value={form.categorieId ?? ''} onChange={(e) => setForm((f) => ({ ...f, categorieId: e.target.value }))}>
                                    <option value="">Non catégorisé</option>
                                    {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                                </select>
                            </div>
                            <div className="form-group">
                                <label className="form-label">MRR manuel (€/mois)</label>
                                <input type="number" min="0" step="0.01" className="form-input" value={form.abonnementMensuelManuel ?? ''} onChange={(e) => setForm((f) => ({ ...f, abonnementMensuelManuel: e.target.value }))} placeholder="0.00" />
                            </div>
                            <div className="form-group">
                                <label className="form-label">Coût mensuel estimé (€/mois)</label>
                                <input type="number" min="0" step="0.01" className="form-input" value={form.coutMensuelEstime ?? ''} onChange={(e) => setForm((f) => ({ ...f, coutMensuelEstime: e.target.value }))} placeholder="0.00" />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                            <button className="btn btn--primary" disabled={saving} onClick={handleSave}>{saving ? 'Sauvegarde...' : 'Enregistrer'}</button>
                            <button className="btn btn--ghost" onClick={() => { setEdit(false); setForm(client); }}>Annuler</button>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px', fontSize: 14 }}>
                        {[
                            ['Prénom', client.prenom],
                            ['Email', client.email],
                            ['Téléphone', client.telephone],
                            ['Adresse', client.adresse],
                            ['Prestations', client.prestations],
                            ['Catégorie', cat?.nom ?? 'Non catégorisé'],
                            ['Coût mensuel estimé', client.coutMensuelEstime ? formatMontant(client.coutMensuelEstime) + ' / mois' : null],
                        ].filter(([, v]) => v).map(([label, val]) => (
                            <div key={label}>
                                <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: 12 }}>{label}</span>
                                <span>{val}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ─── Historique facturations ── */}
            {facturations.length > 0 && (
                <div className="card">
                    <div className="card__title">Facturations</div>
                    <div className="table-wrap">
                        <table>
                            <thead><tr><th>Date</th><th>Lignes</th><th style={{ textAlign: 'right' }}>MRR</th><th style={{ textAlign: 'right' }}>Total</th><th>Stripe</th></tr></thead>
                            <tbody>
                                {facturations.map((f) => (
                                    <tr key={f.id}>
                                        <td style={{ fontSize: 12 }}>{formatDate(f.date)}</td>
                                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                            {f.lignes?.map((l) => l.description).join(', ')}
                                        </td>
                                        <td style={{ textAlign: 'right', fontSize: 12 }}>{f.mrr > 0 ? formatMontant(f.mrr) + '/m' : '—'}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(f.totalFacture)}</td>
                                        <td>{f.withStripe ? <span className="badge badge--success">Encaissé</span> : <span className="badge badge--warning">En attente</span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={3}><strong>Total facturé</strong></td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)' }}>{formatMontant(totalFacture)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}

            {/* ─── Historique versements Stripe (legacy) ── */}
            {versements.length > 0 && (
                <div className="card">
                    <div className="card__title">Versements Stripe</div>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr><th>Date</th><th style={{ textAlign: 'right' }}>Brut</th><th style={{ textAlign: 'right' }}>Frais</th><th style={{ textAlign: 'right' }}>Net</th><th>Récurrence</th></tr>
                            </thead>
                            <tbody>
                                {versements.map((v) => (
                                    <tr key={v.id}>
                                        <td style={{ fontSize: 12 }}>{formatDate(v.dateVirement)}</td>
                                        <td style={{ textAlign: 'right' }}>{formatMontant(v.montantBrut)}</td>
                                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{formatMontant(v.fraisStripe)}</td>
                                        <td style={{ textAlign: 'right', fontWeight: 500 }}>{formatMontant(v.montantNet)}</td>
                                        <td>
                                            {v.recurrence?.type === 'recurrent'
                                                ? <span className="badge badge--info">{v.recurrence.intervalleNombre} {v.recurrence.intervalleUnite}</span>
                                                : <span className="badge badge--muted">Ponctuel</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td><strong>Total</strong></td>
                                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{formatMontant(totalEncaisseStripe)}</td>
                                    <td style={{ textAlign: 'right', color: 'var(--danger)', fontWeight: 600 }}>{formatMontant(versements.reduce((s, v) => s + v.fraisStripe, 0))}</td>
                                    <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--success)' }}>{formatMontant(versements.reduce((s, v) => s + v.montantNet, 0))}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

function MetricCard({ label, value, accent = 'var(--text)', hint }) {
    return (
        <div className="card" style={{ padding: '14px 18px', marginBottom: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: accent }}>{value}</div>
            {hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{hint}</div>}
        </div>
    );
}

function ProjBox({ label, revenu, depense }) {
    const marge = revenu > 0 ? ((revenu - depense) / revenu) * 100 : null;
    return (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--success)' }}>{formatMontant(revenu)}</div>
            {depense > 0 && (
                <>
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2 }}>− {formatMontant(depense)} coûts</div>
                    <div style={{ fontSize: 12, color: marge >= 50 ? 'var(--success)' : 'var(--warning)', fontWeight: 600, marginTop: 4 }}>
                        Marge : {marge?.toFixed(1)} %
                    </div>
                </>
            )}
        </div>
    );
}
