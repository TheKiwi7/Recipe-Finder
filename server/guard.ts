// L'API ne répond qu'à l'app elle-même. Sans ce contrôle, n'importe quel site ouvert dans le navigateur pourrait
// écrire dans l'API (requête POST « simple », sans pré-vérification CORS) ou la lire via un nom de domaine qui
// pointe vers 127.0.0.1 (DNS rebinding).

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const hostname = (h: string) => h.replace(/:\d+$/, '').toLowerCase();

/** En-têtes Host / Origin / Sec-Fetch-Site d'une requête → vient-elle de l'app (ou d'un outil local) ? */
export function isFromApp(host: string | undefined, origin: string | undefined, fetchSite: string | undefined): boolean {
  if (!LOCAL_HOSTS.has(hostname(host ?? ''))) return false;
  if (fetchSite === 'cross-site') return false;
  if (!origin) return true; // outils en ligne de commande, navigation directe
  try { return LOCAL_HOSTS.has(new URL(origin).hostname.toLowerCase()); } catch { return false; }
}
