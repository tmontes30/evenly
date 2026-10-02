# Evenly — Split it. Settle it.

App web para anotar gastos compartidos entre grupos (matri, viajes, depto…) y ver quién le debe cuánto a quién.
HTML/CSS/JS sin build, alojada en GitHub Pages, con login de Google y datos en Firebase (Firestore).

## Cómo calcula
Por cada persona del grupo:

- **Pagó**: suma de los gastos que pagó.
- **Le corresponde**: su parte de cada gasto en que participa (monto ÷ personas marcadas).
- **Saldo** = pagó − le corresponde + pagos hechos − pagos recibidos.
  Positivo → le deben. Negativo → debe.

Después empareja a los que deben con los que tienen saldo a favor para sugerir el mínimo de transferencias.

Ejemplo: Ella pagó $6.300.000 y Tú $600.000 → total $6.900.000, a cada uno le corresponde $3.450.000 → Tú debes $2.850.000. Si registras un pago Tú → Ella de $2.500.000, quedan **$350.000** pendientes.

## Configuración (una sola vez)

### 1. Firebase
1. Entra a <https://console.firebase.google.com> → **Agregar proyecto** (Analytics no es necesario).
2. En el proyecto: **⚙ Configuración del proyecto → Tus apps → `</>` (Web)** → registra la app.
   Copia el objeto `firebaseConfig` y pégalo en [`firebase-config.js`](firebase-config.js).
3. **Authentication → Comenzar → Método de acceso → Google → Habilitar**.
4. **Authentication → Configuración → Dominios autorizados → Agregar dominio**: `TU_USUARIO.github.io`.
5. **Firestore Database → Crear base de datos** (modo producción, región cercana, ej. `southamerica-east1`).
6. **Firestore → Reglas**: reemplaza todo por el contenido de [`firestore.rules`](firestore.rules) y **Publicar**.

### 2. GitHub Pages
1. Crea un repositorio (ej. `evenly`) y sube todos estos archivos a la rama `main`.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. En un par de minutos queda en `https://TU_USUARIO.github.io/evenly/`.

### Probar en tu computador
```
python -m http.server 8000
```
y abre <http://localhost:8000> (`localhost` ya viene autorizado en Firebase).

## Uso
1. Entra con Google y crea un grupo (ej. "Matri").
2. Toca **Invitar** y comparte el link (WhatsApp, copiar, etc.). Quien lo abre entra con Google, pone su nombre y queda en el grupo.
   También puedes agregar personas a mano en **Grupo** (si después entran por el link con el mismo nombre, quedan vinculadas).
   "Generar link nuevo" invalida el anterior.
3. En **Gastos**: anota cada gasto, quién lo pagó y entre quiénes se divide.
4. En **Pagos**: registra cuando alguien le devuelve plata a otro (o usa "Registrar pago" desde el Resumen).
5. **Resumen** muestra quién le debe a quién en tiempo real.

## Seguridad
- La `firebaseConfig` es pública por diseño; lo que protege los datos son las reglas de Firestore.
- Solo los emails en la lista de **Acceso** de un grupo pueden leerlo o modificarlo. Solo quien lo creó puede eliminarlo.

## Archivos
| Archivo | Qué hace |
|---|---|
| `index.html` | Estructura de la página |
| `styles.css` | Diseño (claro/oscuro, móvil) |
| `app.js` | Login, Firestore en tiempo real y vistas |
| `balance.js` | Cálculo de saldos y formato de montos |
| `firebase-config.js` | Tu configuración de Firebase |
| `firestore.rules` | Reglas de seguridad para pegar en la consola |
