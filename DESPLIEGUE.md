# Despliegue en Fly.io

Estado: los ficheros de despliegue están escritos y revisados. **La imagen no se ha
construido**, porque en la máquina donde se escribieron no hay Docker ni Fly CLI.
Eso está anotado en cada punto donde importa.

---

## Lo que hay que hacer, en orden

### 0. Instalar git, si vas a hacerlo desde esta máquina

Aquí no está instalado `git`, ni `gh`, ni `flyctl`, ni Docker. Si el repo lo creás
desde la web de GitHub y subís los ficheros con el botón de la interfaz, no hace
falad nada. Si lo vas a hacer por terminal, hace falta git.

### 1. El repo

```bash
git init
git add .
git commit -m "El bot de Digimon"
```

**Comprobación obligatoria antes de continuar.** El `.gitignore` tiene `/data/` con
barra inicial para que `src/data/` sí viaje. Un `data/` sin barra se llevaría
también el catálogo y el bot moriría al arrancar:

```bash
git ls-files src/data
```

Tiene que listar `catalogo.json`, `dex.json`, `catalogo-activables.json`,
`dex-accepted.json` y `catalogo-propias.json`. Si no lista nada, el `.gitignore` no
se aplicó como se cree y hay que mirarlo antes de seguir.

### 2. El repo en GitHub

```bash
gh repo create digimon-mmo --private --source=. --push
```

`--private` porque el proyecto no es público todavía. Se puede hacer también desde
la web: crear repo vacío, marcarlo privado, y subir.

### 3. Fly

```bash
fly auth login
fly launch --no-deploy --copy-config --name digimon-mmo --region mad
```

`--copy-config` reutiliza el `fly.toml` que ya está escrito, así que no pisa el
volumen ni la región.

### 4. El volumen — antes de la primera app

```bash
fly volumes create digimon_data --region mad --size 1
```

**Este paso va antes del despliegue y no es opcional.** Los volúmenes de Fly se
crean a mano; si desplegás sin él, el bot arranca con una base vacía y da error en
cuanto alguien pulse un botón. Después habría que recuperar los datos a mano.

La región tiene que coincidir con la del `fly.toml`. Un volumen en `mad` no lo ve
una app que arranque en otra región, y el síntoma es el mismo: base vacía.

### 5. Los secretos

```bash
fly secrets set DISCORD_TOKEN=... DISCORD_CLIENT_ID=...
```

No `DISCORD_GUILD_ID`: en producción los comandos se registran globalmente. Con el
guild puesto solo funcionarían en ese servidor de pruebas.

### 6. Desplegar

```bash
fly deploy
fly logs
```

En el log tiene que aparecer la lista de comandos registrados. Si aparece
`Falta src/data/catalogo.json`, el catálogo no entró en la imagen: el paso 1 no se
hizo bien.

---

## Lo que está escrito y por qué

### `Dockerfile`

No compila: `start` es `tsx src/index.ts` y el bot corre TypeScript directamente.
Un `tsc` solo comprueba tipos, y eso se hace antes con `npm run typecheck`.
Generar `dist/` obligaría a tocar el `start`, el `tsconfig` y todas las rutas de
importación.

`better-sqlite3` es nativo. Trae precompilados para Node 20 en linux/x64, que es la
plataforma de la imagen, así que normalmente no compila nada. Las herramientas de
compilación están instaladas igual por si un precompilado falta: sin ellas, una
subida de versión rompería el despliegue sin explicar por qué.

### `fly.toml`

**No tiene `[http_service]`, y es lo correcto.** `src/index.ts` no levanta ningún
servidor HTTP: solo se conecta a Discord. En Fly, una app sin `[http_service]` corre
en modo proceso: sin IP pública, sin enrutado, sin certificados, sin pagar el proxy.

Eso también resuelve el problema clásico de los bots en Fly. Sin servicio HTTP no
aplica `auto_stop_machines`, así que no hay nada que configurar: Fly no suspende una
máquina que no está esperando tráfico, que es lo que le pasaba a los bots que
declaraban un puerto que no usaban.

El arranque está en el `CMD` del Dockerfile y **no** se repite en `[processes]`.
Si estuviera en los dos, Fly arrancaría los dos: dos conexiones a Discord y dos
escritores sobre el mismo SQLite.

### El volumen

`[[mounts]]` monta `digimon_data` en `/app/data`. Como `DATABASE_PATH` es
`./data/digimon.db` y se resuelve contra el directorio de trabajo, que en la imagen
es `/app`, la ruta cae dentro del volumen sin tocar `src/config.ts`.

### El arranque como root

A propósito, no por descuido. El volumen de Fly se crea propiedad de root, y si el
proceso corriera como `node` el primer `INSERT` fallaría con un error de permisos
cuyo síntoma —un bot que se desconecta al primer comando— no señala a los permisos.

La alternativa, si se prefiere:

```bash
fly ssh console -C 'chown -R 1000:1000 /data'
```

y añadir `USER node` al Dockerfile. Es una línea menos de fricción ahora a cambio de
un proceso con más permisos del necesario. En un contenedor de un solo proceso sin
shell, el coste es bajo.

---

## Cosas que no entran en la imagen

`.dockerignore` deja fuera `node_modules/` (se instalan dentro con `npm ci`),
`/data/` (la base va en el volumen) y `.env` (los secretos van aparte).

Los datos de referencia SÍ entran, y tienen que entrar: `src/data/catalogo.json`
son 3,4 MB con 1384 especies. Sin ese fichero el bot no arranca.

---

## Automatizar el despliegue

Ahora mismo, subir al repo no cambia nada: hay que escribir `fly deploy`.

Para que un `git push` despliegue solo, falta un `.github/workflows/deploy.yml`
que ejecute `fly deploy` con `FLY_API_TOKEN` como secreto del repo. Son unas
quince líneas.

Con eso, el flujo queda:

```
cambias código → git push → el workflow despliega → el bot reinicia (~1-2 min)
```

El volumen sobrevive al reinicio, así que los datos de los jugadores no se tocan.

**Aviso**: esto no actualiza nada «en caliente». Un despliegue es un reinicio, las
sesiones de combate en curso se pierden, y el catálogo está dentro de la imagen: si
cambian los datos de referencia hay que volver a desplegar.

---

## Lo que NO se ha verificado

- **La imagen nunca se construyó.** No hay Docker en esta máquina. El `Dockerfile`
  está escrito con la API real de Docker y con las dependencias correctas del
  proyecto, pero eso no es lo mismo que haberlo compilado.
- **`fly launch`, `fly volumes create` y `fly deploy` no se ejecutaron.** No hay
  Fly CLI.
- **El `.gitignore` corregido no se comprobó con `git check-ignore`.** No hay git.
  El paso 1 incluye la comprobación manual, y está ahí por eso.

Lo primero que salga mal, casi con seguridad, será el `npm ci` dentro del contenedor
o el nombre de la app. Los dos se ven en el primer `fly deploy`.
