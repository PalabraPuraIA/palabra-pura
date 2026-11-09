# Guía de usuario — Blaze (Escuela Bíblica Palabra Pura)

Documento para quien **usa** el sistema (feligreses / equipo pastoral / admin).  
No requiere conocimientos técnicos.

## 1. Qué es Blaze

**Blaze** es el asistente de la Escuela Bíblica de Palabra Pura.  
Puedes hacerle preguntas de fe, Biblia y enseñanzas del ministerio. Te responde con base en el contenido cargado (videos, fragmentos, Escritura).

## 2. Cómo entrar al chat

| Dónde | Dirección |
|-------|-----------|
| Red de la iglesia / LAN | Pedir la IP del servidor (ej. `http://10.45.178.129:8088/`) |
| Internet (demo) | Pedir la URL pública del día (cambia si reinician el túnel) |
| GitHub Pages | `https://palabrapuraia.github.io/palabra-pura/` |

No necesitas crear cuenta para chatear.

### Cómo preguntar

1. Abre el chat.
2. Escribe tu pregunta en español (ej. *¿Qué significa nacer de nuevo?*).
3. Envía. Blaze responde con explicación y, cuando hay, referencias a enseñanzas o versículos.
4. Si no encuentra material, te pedirá reformular o elegir otra pregunta del menú.

**Consejos**

- Sé concreto: mejor “¿Qué dice la Biblia sobre el perdón?” que “háblame de todo”.
- Si la respuesta no encaja, reformula con otras palabras.
- Los chats son de la sesión actual; no se mezclan con los de otras personas en tu mismo navegador de la misma forma que una cuenta personal.

## 3. Panel de administración

Solo para el equipo autorizado.

1. Entra a la página de login (ej. `/login.html` o el enlace **Ingresar**).
2. Completa **Usuario** y **Contraseña** del panel.
3. Pulsa **Entrar al panel**.
4. **Ir al chat** vuelve a la conversación pública.

> Ya no hay inicio de sesión con Google ni crear cuenta por correo en esta pantalla. Solo el panel admin.

### Qué puedes hacer en el panel (según permisos del despliegue)

- Ver resumen de consultas / temas frecuentes (analytics).
- Revisar o gestionar conocimiento (knowledge).
- Subir o seguir trabajos de ingesta de contenido (ingest), si está habilitado.

Si olvidaste la contraseña, contacta a quien administra el servidor (no se recupera desde la web pública).

## 4. Contenido que alimenta las respuestas

Blaze no “inventa” la doctrina del ministerio: se apoya en:

- Enseñanzas / videos indexados.
- Fragmentos de transcript con búsqueda semántica.
- Texto bíblico (versiones configuradas en el sistema).
- Artículos del sitio de la iglesia (cuando el chat los muestra).

Si falta una enseñanza nueva, el equipo técnico debe **ingerirla** (dashboard / n8n / scripts); hasta entonces Blaze puede no cubrir ese tema.

## 5. Problemas frecuentes

| Síntoma | Qué hacer |
|---------|-----------|
| La página no carga | Confirmar que el servidor está encendido; en demo, pedir la URL del túnel actual. |
| El chat no responde | Probar más tarde; avisar al admin (`/api/chat/status` lo revisa el técnico). |
| Respuesta vacía / “reformula” | Cambiar la pregunta; puede no haber material indexado. |
| No entro al panel | Verificar usuario/contraseña; limpia caché o prueba en ventana privada. |
| En el celular el teclado tapa el cuadro | Actualiza la página; en versiones recientes el compositor se ajusta. |

## 6. Privacidad (resumen)

- El chat público no exige registro.
- El panel admin es privado.
- Las preguntas pueden registrarse de forma agregada para estadísticas del ministerio (temas más consultados), según la configuración del servidor.

## 7. Contacto

Para fallos técnicos o nuevas enseñanzas a indexar: equipo **PalabraPuraIA** / administrador del servidor Fintek.
