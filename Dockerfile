# Imagen del bot.
#
# No hay compilación: `start` es `tsx src/index.ts`, o sea que el bot corre
# TypeScript directamente. Es una decisión ya tomada en el proyecto y no se toca
# aquí; lo que hace esta imagen es darle lo que ese comando necesita.
#
# Un `tsc` solo serviría para comprobar tipos, y eso se hace antes de desplegar
# con `npm run typecheck`. Generar `dist/` y luego ejecutar `dist/` obligaría a
# tocar el `start`, el `tsconfig` y todas las rutas de importación, a cambio de
# una imagen algo más rápida al arrancar.

FROM node:20-slim

# Herramientas de compilación.
#
# `better-sqlite3` es un módulo nativo y trae binarios precompilados para Node 20
# en linux/x64, que es justo esta plataforma, así que normalmente NO compila nada:
# los descarga. Se instalan las herramientas igual porque si el precompilado no
# existiera para alguna versión, `npm ci` reventaría y el despliegue fallaría sin
# explicar por qué.
#
# Si se quisiera quitar, se puede: son unos 150 MB que solo se usan durante el
# `npm ci`. La contrapartida es que una subida de versión de `better-sqlite3` que
# no tenga precompilado rompe el despliegue.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Las dependencias en su propia capa.
#
# Van solas porque cambian mucho menos que el código: mientras el `package-lock.json`
# no se toque, esta capa se reutiliza de la imagen anterior y `fly deploy` solo
# manda el código nuevo.
COPY package.json package-lock.json ./
RUN npm ci

# El código y los datos de referencia.
COPY tsconfig.json ./
COPY src ./src
COPY tools ./tools
COPY .env.example ./.env.example

# El directorio donde va la base. En Fly lo tapa un volumen; aquí se crea vacío
# para que `src/db/index.ts` pueda escribir sin fallar si alguien corre el bot
# localmente dentro de un contenedor.
RUN mkdir -p /app/data && chown -R node:node /app/data

# Corre como root a propósito, y no por descuido.
#
# El volumen de Fly se crea propiedad de root. Si el proceso corriera como `node`,
# el primer `INSERT` fallaría con «attempt to write a a readonly database» por
# permisos, y el síntoma —un bot que se desconecta al primer comando— no apunta
# nada a los permisos.
#
# La alternativa es una sola vez, por máquina:
#     fly ssh console -C 'chown -R 1000:1000 /data'
# y poner aquí `USER node`. Es una línea menos de fricción ahora a cambio de un
# proceso con más permisos del necesario; en un contenedor de un solo proceso sin
# shell, el coste es bajo.
#
# `--init` porque Node deja procesos zombis si nada recoge la señal: sin init, un
# `fly deploy` puede matar el contenedor antes de que el bot cierre el socket de
# Discord y la base a la vez.
ENTRYPOINT ["/usr/bin/docker-init", "--"]

# `--enable-source-maps` para que los errores en Discord tengan la línea del
# TypeScript y no la del JavaScript compilado.
CMD ["npx", "tsx", "--enable-source-maps", "src/index.ts"]
