/**
 * Clients.jsx  Page liste des clients
 * Filtre par catégorie + recherche par nom
 * Total encaissé Stripe + abonnement mensuel estimé par client
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    collection, query, orderBy, getDocs, where,
    doc, updateDoc, serverTimestamp, addDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { formatMontant } from '../services/helpers';

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

export default function Clients() {
    const navigate = useNavigate();
    const [clients, setClients] = useState([]);
    const [categories, setCategories] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [catFiltreId, setCatFiltreId] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [newNom, setNewNom] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        const [cliSnap, catSnap] = await Promise.all([
            getDocs(query(collection(db, 'clients'), orderBy('nom'))),
            getDocs(query(collection(db, 'categoriesClient'), orderBy('ordre'))),
        ]);
        const cats = catSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setCategories(cats);

        // Charger les totaux Stripe par client (seulement les docs avec clientId)
        const versSnap = await getDocs(
            query(collection(db, 'versementsStripe'), where('clientId', '!=', null))
        );
        const totauxParClient = {};
        const abosParClient = {};
        versSnap.docs.forEach((d) => {
            const v = d.data();
            if (!v.clientId) return;
            totauxParClient[v.clientId] = (totauxParClient[v.clientId] ?? 0) + (v.montantBrut ?? 0);
            if (v.recurrence?.type === 'recurrent' && v.abonnementMensuelEstime) {
                abosParClient[v.clientId] = Math.max(
                    abosParClient[v.clientId] ?? 0,
                    v.abonnementMensuelEstime
                );
            }
        });

        setClients(
            cliSnap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
                totalEncaisse: totauxParClient[d.id] ?? 0,
                abonnementMensuel: abosParClient[d.id] ?? (d.data().abonnementMensuelManuel ?? 0),
            }))
        );
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const filtered = clients.filter((c) => {
        const matchSearch = !search || c.nom?.toLowerCase().includes(search.toLowerCase());
        const matchCat = !catFiltreId || c.categorieId === catFiltreId;
        return matchSearch && matchCat;
    });

    async function creerClient() {
        if (!newNom.trim()) return;
        setSaving(true);
        await addDoc(collection(db, 'clients'), {
            nom: newNom.trim(), prenom: '', email: '', telephone: '', adresse: '',
            prestations: '', categorieId: null, categorieNom: null,
            abonnementMensuelManuel: 0,
            createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        setNewNom(''); setShowNew(false); setSaving(false);
        load();
    }

    async function changerCategorie(clientId, catId) {
        const cat = categories.find((c) => c.id === catId);
        await updateDoc(doc(db, 'clients', clientId), {
            categorieId: catId || null,
            categorieNom: cat?.nom || null,
            updatedAt: serverTimestamp(),
        });
        setClients((prev) => prev.map((c) =>
            c.id === clientId ? { ...c, categorieId: catId, categorieNom: cat?.nom } : c
        ));
    }

    const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));

    return (
        <div>
            <div className="page-header">
                <h1>Clients</h1>
                <div className="page-header__actions">
                    <button className="btn btn--primary" onClick={() => setShowNew(true)}>+ Nouveau client</button>
                    <button className="btn btn--ghost" onClick={() => navigate('/clients/categories')}> Catégories</button>
                </div>
            </div>

            {/* Ajout rapide */}
            {showNew && (
                <div className="card" style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input
                            type="text" className="form-input" placeholder="Nom du client"
                            value={newNom} onChange={(e) => setNewNom(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && creerClient()}
                            autoFocus
                        />
                        <button className="btn btn--primary btn--sm" disabled={saving || !newNom.trim()} onClick={creerClient}>
                            Créer
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => setShowNew(false)}>Annuler</button>
                    </div>
                    <p className="form-hint" style={{ marginTop: 6 }}>Les infos détaillées se complètent sur la fiche client.</p>
                </div>
            )}

            {/* Filtres */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    type="text" className="form-input" placeholder=" Rechercher"
                    style={{ maxWidth: 240 }} value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <select className="form-select" style={{ maxWidth: 200 }} value={catFiltreId} onChange={(e) => setCatFiltreId(e.target.value)}>
                    <option value="">Toutes catégories</option>
                    <option value="__none__">Non catégorisé</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
            </div>

            {loading && <Spinner />}

            {/* Tableau */}
            {!loading && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>Client</th>
                                    <th>Catégorie</th>
                                    <th style={{ textAlign: 'right' }}>Total encaissé</th>
                                    <th style={{ textAlign: 'right' }}>Abo. mensuel estimé</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.length === 0 && (
                                    <tr><td colSpan={5} style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>Aucun client trouvé.</td></tr>
                                )}
                                {filtered.map((c) => {
                                    const cat = catMap[c.categorieId];
                                    return (
                                        <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/clients/${c.id}`)}>
                                            <td>
                                                <div style={{ fontWeight: 500 }}>{c.nom}</div>
                                                {c.email && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.email}</div>}
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <select
                                                    className="form-select"
                                                    style={{
                                                        maxWidth: 160, padding: '4px 8px', fontSize: 13,
                                                        ...(cat ? { borderColor: cat.couleur, color: cat.couleur } : {})
                                                    }}
                                                    value={c.categorieId ?? ''}
                                                    onChange={(e) => changerCategorie(c.id, e.target.value)}
                                                >
                                                    <option value="">Non catégorisé</option>
                                                    {categories.map((cat) => <option key={cat.id} value={cat.id}>{cat.nom}</option>)}
                                                </select>
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 500 }}>
                                                {c.totalEncaisse ? formatMontant(c.totalEncaisse) : ''}
                                            </td>
                                            <td style={{ textAlign: 'right', color: c.abonnementMensuel ? 'var(--success)' : 'var(--text-muted)' }}>
                                                {c.abonnementMensuel ? formatMontant(c.abonnementMensuel) + ' / mois' : ''}
                                            </td>
                                            <td onClick={(e) => e.stopPropagation()}>
                                                <button className="btn btn--sm btn--ghost" onClick={() => navigate(`/clients/${c.id}`)}>
                                                    Voir
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Résumé */}
            {!loading && filtered.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                    <span><strong style={{ color: 'var(--text)' }}>{filtered.length}</strong> client{filtered.length > 1 ? 's' : ''}</span>
                    <span>Total encaissé : <strong style={{ color: 'var(--text)' }}>{formatMontant(filtered.reduce((s, c) => s + c.totalEncaisse, 0))}</strong></span>
                    <span>CA mensuel récurrent estimé : <strong style={{ color: 'var(--success)' }}>{formatMontant(filtered.reduce((s, c) => s + c.abonnementMensuel, 0))}</strong></span>
                </div>
            )}
        </div>
    );
}
