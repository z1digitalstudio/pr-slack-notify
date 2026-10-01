# PR Slack Notify

GitHub Action que publica **un único mensaje por PR** en un canal de Slack y lo va **editando** según cambia el estado de la PR, en lugar de publicar un mensaje nuevo cada vez:

```
Pull request opened by ana
┃ #128 Añadir filtro por fechas al listado de pedidos   ← enlace a la PR
┃ @equipo-dashboard
┃ ⓖ z1digitalstudio/dashboard · Merged   ← repo y estado (si ya no está abierta)
```

La línea lateral cambia de color según el estado:

| Estado | Línea | Nota en el pie |
|---|---|---|
| PR abierta (o lista para revisión) | 🔵 azul | — |
| PR aprobada | 🟢 verde | Approved |
| PR mergeada | 🟣 morada | Merged |
| PR cerrada sin mergear | 🔴 roja | Closed without merging |

Los revisores solo reciben la notificación una vez, al abrirse la PR, porque al editar un mensaje Slack no vuelve a notificar las menciones. Commits, comentarios y "changes requested" no generan nada en Slack.

## Usarla en un repo

La app de Slack (**PR Bot**) ya está creada y su token está en el secret de organización `SLACK_BOT_TOKEN`, disponible para todos los repos. No hace falta ningún token de GitHub.

1. En el canal de Slack del proyecto, escribe `/invite @PR Bot`.
2. Saca el ID del canal: clic en el nombre del canal → al final del panel aparece `C…`.
3. Saca el ID del grupo de revisores: abre Slack en el navegador → **Personas → Grupos de usuarios** → entra en el grupo; el ID `S…` aparece al final de la URL. Para una persona: su perfil → ⋮ → **Copy member ID** (`U…`). Se pueden combinar varios separados por comas: `S0123ABCD, U0AAAAAAA`.
4. En el repo (Settings → Secrets and variables → Actions) crea dos secrets: `SLACK_CHANNEL_ID` con el ID del canal y `SLACK_REVIEWERS` con los IDs del paso 3.
5. Crea `.github/workflows/pr-slack-notify.yml`:

```yaml
name: PR Slack Notify

on:
  pull_request:
    types: [opened, reopened, ready_for_review, closed]
  pull_request_review:
    types: [submitted]

jobs:
  notify:
    runs-on: ubuntu-latest
    concurrency:
      group: pr-slack-notify-${{ github.event.pull_request.number }}
      cancel-in-progress: false
    steps:
      - uses: z1digitalstudio/pr-slack-notify@v1
        with:
          slack_bot_token: ${{ secrets.SLACK_BOT_TOKEN }}
          channel_id: ${{ secrets.SLACK_CHANNEL_ID }}
          reviewers: ${{ secrets.SLACK_REVIEWERS }}
```

### Inputs

| Input | Obligatorio | Descripción |
|---|---|---|
| `slack_bot_token` | sí | Token `xoxb-…` del bot |
| `channel_id` | sí | ID del canal (`C…`) |
| `reviewers` | no | IDs `U…` / `S…` separados por comas |
| `ignore_drafts` | no | `true` por defecto: los drafts se anuncian cuando pasan a *Ready for review* |

Después, quita la suscripción de la app oficial de GitHub en ese canal (`/github unsubscribe owner/repo`) para quitar el ruido.

## Cómo funciona

- Al publicar, el mensaje lleva [metadatos de Slack](https://api.slack.com/metadata) con el repo y el número de PR. En los eventos siguientes, la action busca ese mensaje en el historial del canal (solo desde la fecha de creación de la PR) y lo edita con `chat.update`.
- Si una PR se abrió antes de instalar la action, no hay mensaje que editar y la action no publica nada.
- Una aprobación sobre una PR ya cerrada no cambia nada, para no tapar el morado.
- **Forks:** los workflows con `pull_request` de forks no tienen acceso a secrets. Si recibís PRs de forks, cambia `pull_request` por `pull_request_target` (la action no hace checkout del código, así que es seguro).

## Publicar una versión

```bash
git tag v1.0.0 && git tag -f v1 && git push origin v1.0.0 && git push -f origin v1
```

Si el repo es **privado**, ve a *Settings → Actions → General → Access* y permite el acceso desde los repos de la organización.

## Desarrollo

Sin dependencias. Tests: `node --test`.
