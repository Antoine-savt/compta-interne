/**
 * sendRdvReminder.js
 * Netlify Serverless Function pour l'envoi des emails de rappel de RDV
 */

exports.handler = async function (event) {
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
            },
            body: '',
        };
    }

    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Méthode non autorisée' }),
        };
    }

    try {
        const body = JSON.parse(event.body || '{}');
        const {
            to,
            clientNom,
            clientContact,
            clientTelephone,
            date,
            heureDebut,
            heureFin,
            type,
            quiGere,
            notes,
            lienVisio,
            delayMinutes = 15,
            isTest = false,
        } = body;

        if (!to) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Adresse email destinataire manquante' }),
            };
        }

        const typeLabel =
            type === 'telephone'
                ? 'Appel téléphonique'
                : type === 'presentiel'
                ? 'Rendez-vous en présentiel'
                : 'Visioconférence';

        const subject = isTest
            ? `[TEST] Configuration des notifications RDV réussie`
            : `Rappel RDV dans ${delayMinutes} min : ${clientNom} (${typeLabel})`;

        const textContent = `
Bonjour ${quiGere || ''},

${isTest ? 'Ceci est un email de TEST pour valider la réception de vos notifications de rendez-vous.' : `Votre prochain rendez-vous a lieu dans environ ${delayMinutes} minutes.`}

DÉTAILS DU RENDEZ-VOUS :
─────────────────────────────────────────────
• Client / Prospect : ${clientNom}
• Contact           : ${clientContact || 'Non renseigné'} ${clientTelephone ? `(${clientTelephone})` : ''}
• Date              : ${date}
• Horaire           : ${heureDebut} - ${heureFin || ''}
• Format            : ${typeLabel}
• Qui s'en occupe   : ${quiGere || 'Équipe'}
${lienVisio ? `• Lien de connexion : ${lienVisio}` : ''}
${notes ? `• Notes / Ordre du jour : ${notes}` : ''}
─────────────────────────────────────────────

Cet email a été envoyé automatiquement par votre outil de gestion Compta / CRM Wheeloh.
`.trim();

        console.log(`[Rappel RDV Email] Envoi vers ${to} :`, {
            subject,
            clientNom,
            date,
            heureDebut,
            isTest,
        });

        // Intégration optionnelle Resend ou SendGrid si la clé API est fournie dans l'environnement Netlify
        if (process.env.RESEND_API_KEY) {
            const resendRes = await fetch('https://api.resend.com/emails', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                },
                body: JSON.stringify({
                    from: process.env.EMAIL_FROM || 'RDV Notifications <notifications@resend.dev>',
                    to: [to],
                    subject,
                    text: textContent,
                }),
            });
            const resendData = await resendRes.json();
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ok: true, service: 'resend', data: resendData }),
            };
        }

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ok: true,
                simulated: true,
                message: `Email consigné avec succès pour ${to}`,
                previewSubject: subject,
            }),
        };
    } catch (err) {
        console.error('Erreur fonction sendRdvReminder:', err);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: err.message || 'Erreur interne lors de l\'envoi de l\'email' }),
        };
    }
};
