# Sécurité

*English version below.*

## Signaler une faille

Merci de **ne pas ouvrir d'issue publique** pour une faille de sécurité. Utilise le signalement privé de GitHub : onglet **Security** du dépôt → **Report a vulnerability**. Seul le mainteneur le voit ; une réponse est donnée dès que possible et un correctif publié dans une nouvelle version.

## Versions suivies

Seule la dernière version publiée (tag `vX.Y.Z`) reçoit des correctifs. L'app propose elle-même les mises à jour dans Réglages → Mises à jour.

## Ce que fait l'app pour limiter les risques

- Le serveur n'écoute que sur 127.0.0.1 et l'API refuse les requêtes venant d'autres sites ou d'un autre nom d'hôte (DNS rebinding).
- Aucune donnée ne quitte le PC, sauf ce qui est envoyé à Claude par le compte de l'utilisateur quand il l'utilise ; le CLI `claude` est lancé sans outils.
- Les mises à jour n'installent que des versions publiées (tags protégés contre la suppression et le déplacement), en avance rapide, sans écraser de fichiers modifiés à la main.

---

# Security

## Reporting a vulnerability

Please **don't open a public issue** for a security vulnerability. Use GitHub's private reporting: the repository's **Security** tab → **Report a vulnerability**. Only the maintainer sees it; you'll get an answer as soon as possible and a fix released in a new version.

## Supported versions

Only the latest published version (tag `vX.Y.Z`) gets fixes. The app offers updates itself in Settings → Updates.

## What the app does to limit risks

- The server only listens on 127.0.0.1 and the API rejects requests coming from other sites or another host name (DNS rebinding).
- No data leaves the PC, except what is sent to Claude through the user's own account when they use it; the `claude` CLI runs without tools.
- Updates only install published versions (tags protected against deletion and moving), fast-forward only, without overwriting hand-edited files.
