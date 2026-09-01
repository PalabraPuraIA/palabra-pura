# Acceso desde otro PC

Cómo un segundo computador entra al servidor propio, ve la página y **edita los archivos** del proyecto.

Datos del servidor:

| Dato | Valor |
|---|---|
| IP (red local) | `10.45.178.129` |
| Usuario | `fintek-1` |
| Carpeta del proyecto | `/home/fintek-1/palabra-pura` |
| Autenticación SSH | **solo llave** (contraseña deshabilitada) |

## 1. Ver la página (no requiere llave)

Desde cualquier equipo en la misma red:

- Chat: http://10.45.178.129:8088/
- Dashboard: http://10.45.178.129:8088/dashboard/
- Estado del chat: http://10.45.178.129:8088/api/chat/status

Desde fuera de la red se usa el túnel de Cloudflare, cuya dirección cambia al
reiniciarse. Para ver la vigente:

```bash
curl -s http://10.45.178.129:8088/api/public-url
```

## 2. Entrar al servidor y editar archivos

Hay una llave dedicada para el segundo PC: **`id_ed25519_palabra_pc2`**
(ya está autorizada en el servidor).

### Instalar la llave en el otro PC

Copia los dos archivos a la carpeta `.ssh` de ese equipo y ajusta permisos:

```bash
# macOS / Linux
mkdir -p ~/.ssh
cp id_ed25519_palabra_pc2 id_ed25519_palabra_pc2.pub ~/.ssh/
chmod 600 ~/.ssh/id_ed25519_palabra_pc2
```

En Windows la carpeta es `C:\Users\TU-USUARIO\.ssh\`.

### Conectarse

```bash
ssh -i ~/.ssh/id_ed25519_palabra_pc2 fintek-1@10.45.178.129
cd /home/fintek-1/palabra-pura
```

Para no escribir la ruta de la llave cada vez, agrega en `~/.ssh/config`:

```
Host palabra-server
  HostName 10.45.178.129
  User fintek-1
  IdentityFile ~/.ssh/id_ed25519_palabra_pc2
  IdentitiesOnly yes
```

Luego basta `ssh palabra-server`.

### Editar con interfaz gráfica

- **VS Code o Cursor:** extensión **Remote-SSH** → conectar a `palabra-server`
  → abrir carpeta `/home/fintek-1/palabra-pura`. Se edita como si fuera local.
- **Windows (archivos):** WinSCP o FileZilla, protocolo **SFTP**, host `10.45.178.129`,
  usuario `fintek-1`, y seleccionar la llave privada.
- **Terminal:** `sftp -i ~/.ssh/id_ed25519_palabra_pc2 fintek-1@10.45.178.129`

## 3. Aplicar los cambios después de editar

Los archivos del front (`web/app/`) están montados en vivo: se ven al recargar el navegador.

Si tocas el servidor Node (`web/server/`), el `Dockerfile` o el `docker-compose.yml`,
hay que reconstruir. Dentro del servidor:

```bash
cd /home/fintek-1/palabra-pura
./stack/scripts/deploy-local.sh
```

## 3b. Git en el servidor

El repo del proyecto es **privado**: `PalabraPuraIA/palabra-pura`.
Al ser privado, abrirlo en el navegador sin estar en la cuenta `palabrapuraia@gmail.com`
da 404. Eso es normal, no significa que no exista.

El servidor ya está autenticado con una **deploy key** propia
(`~/.ssh/id_ed25519_palabra_deploy`) que permite **leer y escribir** ese repo.
No hace falta `gh auth login` ni contraseñas: desde el servidor, git ya funciona.

Ciclo de trabajo completo, dentro del servidor:

```bash
cd /home/fintek-1/palabra-pura

git pull                                  # traer lo último
# ...editar archivos...
./stack/scripts/deploy-local.sh           # solo si tocaste web/server, Dockerfile o compose
git add -A
git commit -m "Descripción del cambio"
git push
```

`origin` es el único remoto. El repo viejo, que estaba en una cuenta personal,
quedó desconectado: este proyecto vive solo en la cuenta de Palabra Pura.

### Qué no se debe tocar

| Ruta | Motivo |
|---|---|
| `stack/.env` | Claves y contraseñas del servidor. Fuera de git a propósito. |
| `db/data.sql` | 505 MB de contenido. Fuera de git. |
| Volúmenes Docker | `palabra-pura-pgdata` guarda la base viva. No borrar. |

## 4. Autorizar otro equipo más adelante

En el equipo nuevo:

```bash
ssh-keygen -t ed25519 -C "nombre-del-equipo"
cat ~/.ssh/id_ed25519.pub
```

Y desde un equipo que ya tenga acceso:

```bash
ssh palabra-server 'echo "PEGA_AQUI_LA_CLAVE_PUBLICA" >> ~/.ssh/authorized_keys'
```

## Seguridad

- La llave privada **no va a git** (`.gitignore` cubre `*.pem` y llaves; nunca la subas).
- Si un equipo se pierde, borra su línea de `~/.ssh/authorized_keys` en el servidor.
- Quien entra por SSH es `fintek-1`, así que tiene acceso a **todo** lo de ese usuario
  en el servidor, no solo a Palabra Pura. Dale la llave solo a quien deba administrarlo.
