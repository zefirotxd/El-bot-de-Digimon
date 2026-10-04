# Digimon MMO

Bot de Discord con un RPG por turnos: eliges tu primer Digimon, lo subes de
nivel, lo haces evolucionar por la cadena completa y te enfrentas a salvajes
salvajes por el Archivo Digital.

**Stack:** Node.js 20+ · discord.js 14 · SQLite (better-sqlite3) · TypeScript

---

## Puesta en marcha

### 1. Crear el bot en Discord

1. Ve a <https://discord.com/developers/applications> → **New Application**.
2. Copia el **Application ID** (General Information).
3. Ve a **Bot** → **Reset Token** y cópialo. No se puede volver a ver.
4. En **OAuth2 → URL Generator**, marca los scopes `bot` y `applications.commands`.
5. **Bot Permissions**: `View Channels`, `Send Messages`, `Embed Links`,
   `Use External Emoji`. En el enlace de invocación, sustituye `BOT` por el
   Application ID.
6. Invítalo a tu servidor de pruebas.

> El bot **no** usa el intent *Message Content* ni el prefijo `!`: todo va por
> slash commands, así que funciona con los intents por defecto.

### 2. Configurar el proyecto

```bash
npm install
copy .env.example .env      # Windows
# cp .env.example .env      # Linux / macOS
```

```ini
DISCORD_TOKEN=el_token_del_paso_1.3
DISCORD_CLIENT_ID=el_application_id
DISCORD_GUILD_ID=id_de_tu_servidor_de_pruebas   # opcional, solo desarrollo
DATABASE_PATH=./data/digimon.db
MAX_PARTY_SIZE=4     # Digimon que pelan a la vez
PC_CAPACITY=200      # Digimon depositados
```

`DISCORD_GUILD_ID` solo para desarrollo: los comandos aparecen al instante en
ese servidor. **Déjalo vacío en producción** o tardarán hasta una hora en
propagarse globalmente.

### 3. Arrancar

```bash
npm run register     # publica los comandos slash
npm run dev          # arranca el bot
```

La base de datos se crea sola en el primer arranque. Las migraciones son
idempotentes: si actualizas el bot, se añaden las columnas nuevas solo.

---

## El Digivice

`/digivice` es el centro del juego. Abre el dispositivo con el Digimon **líder**
(el primero de tu equipo activo) y su ficha completa:

```
╔══════════════════════════════════════════════╗
║ VIR-FUE // AGUMON                            ║
╟──────────────────────────────────────────────╢
║ 🦖 Agumon   Nv.12  Rookie                    ║
║ ATRIB   ☣️ VIR Virus                         ║
║ ELEM    🔥FUE                                ║
║                                              ║
║ HP      ██████████████                       ║
║         264 / 264                            ║
║                                              ║
║ ATQ █████··· 126                             ║
║ DEF █████··· 116                             ║
║ VEL █████··· 110                             ║
║                                              ║
║ EXP    ▓▓▓▓▓░░░░░░░ 148/236                  ║
╟──────────────────────────────────────────────╢
║ EQUIPO 4/4   PC 3/200   ESTADO Normal        ║
╚══════════════════════════════════════════════╝
```

Con los botones de abajo se navega entre Digimon y se gestiona el equipo sin
salir del dispositivo:

| Botón | Qué hace |
|---|---|
| **(nombre del Digimon)** | Abre su ficha *Setup* con stats, afinidades y movimientos |
| **⭐ Poner de líder** | Lo pone primero en el Digivice y en combate |
| **🗄️ PC** | Abre el depósito |
| **📤 Sacar al equipo** | Saca un Digimon del PC |
| **◀️ Volver** | Regresa a la pantalla principal |

## Comandos

| Comando | Qué hace |
|---|---|
| `/digivice` | Abre el dispositivo: líder, fichas y gestión del equipo |
| `/perfil` | Registra tu entrenador (eligiendo inicial) o muestra tu ficha |
| `/explorar` | Encuentro por la zona (salvaje o entrenador rival) |
| `/rival [jefe]` | Enfréntate a un entrenador con equipo de varios Digimon |
| `/entrenadores` | Qué trainers hay y a qué nivel te esperan |
| `/atacar <especie> [nivel] [jefe]` | Combate contra una especie concreta |
| `/equipo ver [id]` | Tu plantilla y el contenido del PC |
| `/equipo lider` | Cambia el Digimon líder |
| `/equipo guardar` | Manda un Digimon al PC |
| `/equipo descansar` | Cura al equipo y quita estados |
| `/pc ver` | Qué hay en el equipo y en el PC |
| `/pc guardar <id>` | Manda un Digimon al PC |
| `/pc sacar <id>` | Saca un Digimon del PC al equipo |
| `/tienda ver` | Catálogo de objetos y tus DigiBytes |
| `/tienda comprar <objeto> [n]` | Compra objetos |
| `/tienda inventario` | Solo lo que llevas encima |
| `/zonas ver` | Zonas del Mundo Digital y dónde estás |
| `/zonas ir <zona>` | Cambia de zona |
| `/zonas jefe` | Retar al guardián de tu zona |
| `/evolucion ver [nombre]` | Árbol evolutivo con lo que te falta en cada ruta |
| `/evolucion elegir <nombre> ruta:<n>` | Evoluciona por una ruta (cobra materiales y DB) |
| `/evolucion regresar <nombre>` | Deshace una evolución pagando material |
| `/evolucion coleccion` | Formas desbloqueadas, agrupadas por rango |
| `/evolucion historial <nombre>` | Ruta que ha recorrido un Digimon |
| `/equipo arma <id> <pieza>` | Equipa una pieza (arma, armadura, chip, accesorio) |
| `/equipo quitar [id]` | Quita el equipo |
| `/equipo mejorar <pieza>` | Sube una pieza +1 (hasta +5) |
| `/apodo <id> <nombre>` | Nombra a un Digimon (`—` para quitarlo) |
| `/leaderboard [categoría]` | Clasificación global |
| `/descubrir` | Bestiario de salvajes por banda de nivel |
| `/pokedex [nombre]` | Ficha de cualquier especie |
| `/misiones diarias` / `semanales` | Misiones del día o de la semana, con botón de reclamo |
| `/logros ver` / `reclamar` / `titulos` | Logros de por vida y títulos exclusivos |
| `/mazmorra ver` | Mazmorras, energía diaria y tu progreso |
| `/mazmorra entrar <nombre>` | Empieza o continúa por la sala que toque |
| `/incursion ver` | Estado del jefe global y tu contribución |
| `/incursion atacar` | Golpea al jefe global (vida compartida) |
| `/incursion ranking` | Quién más ha pegado en la incursión |
| `/pvp buscar` / `/pvp cancelar` | Cola de emparejamiento por poder |
| `/pvp rango` / `/pvp diaria` | Rango, puntos y racha |
| `/ayuda` | Guía de inicio |

### Equipo activo, PC y líder

- **Equipo activo**: hasta `MAX_PARTY_SIZE` Digimon (4 por defecto). Solo estos
  pelean y solo estos ganan EXP.
- **PC**: el depósito, hasta `PC_CAPACITY` Digimon. Descansan dentro, pero no
  pelan. Es donde metes a los que no te sirven ahora.
- **Líder**: el primero del equipo. Sale en el Digivice y abre el combate. Si lo
  mandas al PC, otro asume el liderazgo automáticamente.
- Reglas: no se puede superar el límite del equipo, no se puede meter al último
  miembro al PC, y no se puede tocar el Digimon de otro usuario.

### Cómo se juega un combate

El bot publica un mensaje con botones que se actualizan cada turno:

- **⚔️ Atacar** — abre un menú con tus movimientos (energía, potencia, precisión)
- **🧪 Objetos** — Poción ×3, Superpoción ×1, Repelente ×1
- **📦 Capturar** — hasta 3 DigiCápsulas por combate
- **🛡️ Defender** — duplica la Defensa ese turno
- **🏃 Huir** — más fácil si eres más rápido

Si tu Digimon activo cae aparecen botones para cambiar a otro del equipo. Al
acabar, el equipo descansa y recupera todos los PV.

---

## Sistema de combate: dos capas

Igual que en **Digimon Story: Time Stranger**, el daño combina dos factores
independientes. Esa es la clave estratégica del juego.

### Capa 1 — Atributo (piedra, papel o tijera)

```
        Vacuna
       ╱      ╲
    Datos      Virus      →  Vacuna > Virus
       ╲      ╱             Virus  > Datos
        ╲    ╱               Datos  > Vacuna
```

Multiplicador: **×1.25** a favor, **×0.85** en contra.

Cuatro atributos no participan en el triángulo y hacen siempre ×1.0:
**Free**, **Unknown**, **Variable** y **Sin Datos**. `Variable` es un caso
especial del canon: adopta el atributo del rival, así que nunca tiene ventaja
ni desventaja.

### Capa 2 — Afinidad elemental

Cada Digimon tiene sus **propias** resistencias y debilidades. No hay una tabla
global tipo Pokémon: los datos viven en la especie (`weakTo` y `resists`).

Escala del juego: **◎ 1.8x** (muy débil) · **△ 0.6x** (resiste) · **ー 1x**.

Los 11 elementos: Fuego, Hielo, Planta, Agua, Rayo, Metal, Viento, Tierra, Luz,
Oscuridad y Nulo.

### Cómo se combinan

```
daño = base × ATRIBUTO × ELEMENTAL × STAB
```

Un **Ataque de tipo Vacuna** (fuerte contra Virus) que además es **Fuego**
contra un rival muy débil a Fuego pega `1.25 × 1.8 × 1.2 = 2.7x`. Ese mismo
ataque contra un rival que resiste Fuego se queda en `1.25 × 0.6 × 1.2 = 0.9x`.

**STAB** (+20%) es el bonus por usar un movimiento del mismo elemento que tu
Digimon.

### Evolucionar cambia tu tipo

Las evoluciones pueden cambiar de atributo, y son los **canónicos**:

| Evolución | Cambio |
|---|---|
| Gabumon → Garurumon | Datos → **Vacuna** |
| MetalGreymon → WarGreymon | Virus → **Vacuna** |
| WereGarurumon → MetalGarurumon | Vacuna → **Datos** |

Evolucionar no solo sube stats: **reordena tus emparejamientos**. El panel de
análisis del Digivice te dice cuánto pega cada movimiento contra cada rival
(`◎ Devastador`, `🔥 fuerte`, `✅ bien`, `➖ neutro`, `🐌 flojo`).

### Otras reglas

- El orden de turno se decide por **prioridad** del movimiento y luego por
  **Velocidad**; si empatan, al azar.
- La **energía** se recarga +1 por turno (máx. 4, y 5 desde el nivel 15).
- Los **estados alterados** (quemadura, veneno) hacen daño al final del turno.
- Al subir de nivel **no pasa nada por tu cuenta**: aprendes movimientos y se
  desbloquean rutas de evolución, pero transformarte es cosa tuya
  (`/evolucion elegir`). Puedes aplazar la evolución indefinidamente sin
  perder el acceso a la ruta.

---

## Árbol evolutivo

La evolución es **manual y con ramas**. El nivel es el requisito, no el
disparador: subir a Nv.40 no te convierte en nada hasta que elijas la
forma con `/evolucion elegir`.

### El árbol

```
  Agumon
   └─ Nv.12 → Greymon
               ├─ Nv.25 → MetalGreymon
               │               ├─ Nv.45 → WarGreymon        (final)
               │               └─ Nv.50 → SkullGreymon      🔀
               │                   45 vict. · 8000 DB · 2x Cromonizador + 1x Espectro
               └─ Nv.40 → MasterTyrannomon              🔀
                   30 vict. · 5000 DB · 3x Núcleo de Datos
```

La misma estructura se repite en otras líneas:

| Desde | Ruta principal | Rama | Qué cambias a cambio |
|---|---|---|---|
| Greymon | WarGreymon (Nv.45) | **MasterTyrannomon** (Nv.40) | +10 PV, +6 DEF, −22 vel. Atajo a Mega sin cromonizador |
| MetalGreymon | WarGreymon (Nv.45) | **SkullGreymon** (Nv.50) | +18 ATQ, −22 PV. Cristal de una tirada |
| Angemon | Magnadramon (Nv.45) | **Cherubimon** (Nv.28) → Diaboromon | +12 ATQ, +4 vel, −22 PV y se rompe con agua |
| Garudamon | Valemon (Nv.45) | **Phoenixmon** (Nv.50) | +6 vel, −8 PV. La forma más rápida del catálogo |
| Ogremon | Groundramon (Nv.45) | **Seraphimon** (Nv.50) | +14 PV, +4 DEF, −14 vel. El más duro |

Las 5 ramas cambian también la **identidad elemental** (elementos, debilidades
y resistencias), así que no son el mismo Digimon con otro nombre: cambian
a quién gana en el triángulo y con qué elementos.

Los Digimon de rama son Mega (o Ultimate en el caso de Cherubimon) y **no
aparecen salvajes**: solo se llega a ellos evolucionando.

### Requisitos

Una ruta puede pedir cualquier combinación de:

| Tipo | Ejemplo |
|---|---|
| Nivel | `Nv.40` |
| Victorias del entrenador | `45 vict.` |
| DigiBytes | `8000 DB` |
| Materiales | `2x Cromonizador + 1x Espectro Digimon` |

Los tres materiales (`nucleo_datos`, `cromonizador`, `espectro_digimon`) se
compran en `/tienda`. Son el peaje de las ramas: si evolucionar solo costara
nivel, la decisión sería trivial (subes siempre) y el árbol no sería una
decisión.

### Regresión

Todo Digimon con ruta de vuelta puede deshacer su evolución con material:
`/evolucion regresar`. Es lo que evita que elegir sea una apuesta irreversible
con la temporada entera. Si tomaste la rama equivocada, gastas material y
vuelves a la forma anterior — el historial lo registra como `regresion`.

### Garantías

- **Cobrar y evolucionar es una sola transacción.** O entran el dinero, los
  materiales y el cambio de especie, o no entra ninguno. Nunca pierdes
  material por un fallo a medias.
- **Las estadísticas se recalculan, nunca se suman.** Se derivan de
  `especie + nivel`, y el equipo se suma aparte. Por eso evolucionar y
  reequipar no escala nada dos veces, y desequipar devuelve exactamente las
  cifras de antes.
- **Idempotente**: pulsar dos veces el mismo botón no cobra dos veces ni
  evoluciona dos veces; la segunda ya no tiene ruta que tomar.
- **El PvP no toca nada de esto**: sigue trabajando sobre copias.
- **Historial append-only** en `digimon_evolution`, para poder auditar la
  ruta de un Digimon sin reconstruir el árbol.

### Verificación

```bash
npm run check:evolution
```

Cubre los ocho invariantes: subir de nivel no evoluciona, la evolución cambia
la especie una sola vez, la inválida no consume nada, repetir la interacción
no duplica coste, evolucionar+reequipar no escala dos veces, el PvP no toca
el progreso, los Digimon previos sobreviven a la migración, y todos los
requisitos del catálogo son válidos, alcanzables y no dominantes.

---
## Misiones y logros

### Una recompensa, una vez

Vive en `claimed_at`, con clave por periodo. Ni mil clics ni un reinicio
del bot devuelven el botón. Pagar y marcar ocurren en la misma
transacción: marcar antes de dejaría al jugador sin nada si el pago
fallara, y pagar antes dejaría el botón vivo para siempre.

### El progreso se mide en el periodo

`trainer_daily` lleva una fila por día y métrica. La misión diaria lee
hoy; la semanal suma los siete días de la semana ISO (que empieza en
lunes: un domingo pertenece a la semana del lunes anterior).

Medir contra el total de por vida con una "línea base" capturada al abrir
la lista fallaba por partida doble: si completabas y reclamabas sin
mirar, la base se capturaba después de tus victorias; y al día siguiente
la misión se cumplía sola porque el contador seguía arriba.

### Dos vectores de farm que hubo que cerrar

- `markClaimed` hacía `UPDATE` sobre una fila que podía no existir si
  nadie había mirado la lista. No escribía nada y el botón pagaba cada
  vez. Ahora es UPSERT.
- Lo mismo con `setAchievementClaimed`: un logro nunca listado se
  reclamaba infinitas veces.

### Contenido

| | |
|---|---|
| Misiones diarias | 8, con objetivos cortos a propósito |
| Misiones semanales | 8, con recompensa mayor |
| Logros | 26, de por vida, con rareza |
| Títulos exclusivos | 12, como recompensa única |

Los logros están escalonados: los primeros a 1 y 10, los últimos a
100.000. Un catálogo con solo metas de 1000 no da ningún motivo para
volver.

El progreso se alimenta desde `saveBattleResult` (victorias y
exploraciones), la captura, las evoluciones, `markBossBeaten` (solo la
primera vez), `clearRoom`, el daño a jefes y las mejoras de equipo. Las
victorias de PvP van a su propia métrica para que la misión de PvP no se
complete jugando en solitario.

### Verificación

```bash
npm run check:missions
```

---

## Mazmorras y jefes

### Un jefe no es "el mismo con más PV"

Cada jefe tiene **fases**. Al cruzar umbrales de vida cambia el atributo,
las resistencias o la dureza:

| Jefe | Fases | El giro |
|---|---|---|
| 🌋 **Ceniza Viva** | 3 | La fase 2 se llama "Furia Ígnea" y **resiste fuego**. Lo contrario de lo que esperas. |
| 🕊️ **Guardiana de la Luz** | 2 | Al pasar a la fase 2 se vuelve **inmune a luz**. Si tenías todo tu daño en luz, te has quedado sin respuesta. |
| 🗿 **Titanramon** | 4 | Cambia de atributo tres veces y se cura un 5% por turno en las fases medias. |

La regla de diseño que se comprueba en los tests: **cada fase tiene que
cambiar algo que el jugador pueda leer en el panel de análisis**. Si una
fase solo sube el PV, no es una fase.

### Ataques telegrafiados

El jefe anuncia un golpe con **dos turnos de margen** y hay cuatro
respuestas. Ninguna es gratis:

| Respuesta | Recorte | Coste |
|---|---|---|
| Digimon con el elemento correcto | **95%** | Tenerlo en el equipo y haberlo sacado |
| Defender | 60% | Pierdes el turno de ataque |
| Cambiar de Digimon | 50% | El nuevo aguanta parte de lo que el anterior se llevaba encima |
| Curarte con un objeto | 40% | Gastas el objeto |

La exposición al elemento se recalcula **en el momento del impacto**, no al
anunciar: si cambias de Digimon entre el aviso y el golpe, cuenta el
elemento del nuevo.

### Mazmorras

- **Progreso guardado sala a sala.** Perder en la tercera no borra la
  primera ni la segunda.
- **Energía diaria** de 12, persistente por fecha: reiniciar el bot no te
  devuelve energía.
- **3 intentos por mazmorra al día**, contando entradas (jugar la sala 1
  cinco veces son cinco intentos).
- **La recompensa escala por contribución**, no por participar. Tirar al
  jefe al 70% paga el 70% de los materiales; quedarte al 20% no paga
  materiales. Es lo que hace que farmear la mazmorra muriendo en la sala 1
  no salga a cuenta.

### Incursión global

Un jefe con la vida **compartida y persistida**: el daño que mete cada
jugador va a la misma barra y sobrevive a los reinicios del bot. Se paga por
daño hecho y hay clasificación de contribución. Rotación cada 3 días.

### Verificación

```bash
npm run check:dungeon
npm run check:missions
```

Cubre ocho cosas: que los jefes tengan mecánicas propias, que las fases
cambien algo legible, que los telegrafiados avisen con margen y se puedan
responder, que el progreso se guarde sala a sala, que la recompensa escale
con la contribución, que energía e intentos sean diarios, que la vida
global sea compartida, y que ni mazmorra ni incursión tochen progreso
inesperado.

---

## Estructura

```
src/
├── index.ts                 Entry point: cliente y router de interacciones
├── config.ts                Configuración (validación perezosa de Discord)
├── db/
│   ├── index.ts             Conexión, esquema y migraciones ligeras
│   └── schema.sql
├── game/                    Lógica pura, SIN dependencias de Discord
│   ├── types.ts             Tipos compartidos
│   ├── attributes.ts        Capa 1: triángulo de atributos
│   ├── elements.ts          Capa 2: afinidades y multiplicadores
│   ├── items.ts             Catálogo de objetos
│   ├── moves.ts             ~45 movimientos
│   ├── species.ts           29 Digimon, atributos, afinidades y evoluciones
│   ├── trainers.ts          11 plantillas de rivales (10 trainers + jefes)
│   ├── zones.ts             5 zonas con bestiario y guardián
│   ├── stats.ts             Curvas de crecimiento, EXP y daño
│   ├── combat.ts            Motor de turnos, IA, capturas y cambios
│   ├── progression.ts       Encuentros y recompensas
│   ├── random.ts            RNG con semilla dispersa
│   ├── repository.ts        Acceso a datos, party, PC, inventario y progreso
│   └── combat.test.ts       75 tests
├── services/
│   ├── battleSession.ts     Botones, selects y recompensas del combate
│   └── rateLimit.ts         Enfriamientos y tope global
├── commands/                Un fichero por comando
│   ├── digivice.ts          El dispositivo y sus acciones
│   ├── pc.ts                Depósito
│   ├── tienda.ts            Economía
│   ├── zonas.ts             Viaje y jefes
│   └── ...
├── views/
│   ├── digivice.ts          Marco ASCII y fichas del dispositivo
│   └── embeds.ts            Embeds de combate, perfil y recompensas
└── scripts/
    └── registerCommands.ts

tools/
├── run-tests.ts             Runner de tests (Node 20 no acepta globs)
├── balance.ts               Simulador de balance
├── check-db.ts              Registro, party, PC, progresión y combate
├── check-shop.ts            Inventario, compra y gasto en combate
├── check-rival.ts           Equipos rivales, cambios y recompensas
└── check-ui.ts              Valida comandos y embeds sin token
```

**Regla de oro:** `src/game/` no importa nada de `discord.js`. El motor de
combate se puede testear y reutilizar tal cual.

---

## Verificación

```bash
npm run typecheck   # TypeScript sin errores
npm test            # 75 tests
npm run check:db    # registro, party, PC, progresión y combate contra SQLite
npm run check:shop  # inventario, compra y gasto de objetos
npm run check:rival # equipos rivales, cambios en caliente y recompensas
npm run check:evolution
npm run check:dungeon
npm run check:missions
npm run check:ui    # serializa comandos y construye todos los embeds
npm run balance     # simula 180 combates por banda de nivel
```

Los tests cubren el triángulo de atributos, que las afinidades sean coherentes
por Digimon, que el motor sea simétrico (combate espejo ~50/50), que la energía
se regenere, que las bandas de encuentro no estén dominadas por un atributo, que
ningún rival tenga su equipo entero de un atributo, que las zonas no dejen
huecos, que un Digimon caído no pueda volver a entrar, que el rate limit
bloquee y expire, y que la queue party/PC respete los límites.

`npm run balance` fue la herramienta más útil durante el desarrollo: imprime
duración de combate, tasa de victoria por inicial y recompensas por nivel.

---

## Constantes de balance

| Constante | Archivo | Efecto |
|---|---|---|
| `DAMAGE_SCALE` | `game/stats.ts` | Daño global. Más bajo = combates más largos |
| `ATTRIBUTE_STRONG` / `_WEAK` | `game/attributes.ts` | Fuerza del triángulo (1.25 / 0.85) |
| `ELEMENT_WEAK` / `_RESIST` | `game/elements.ts` | Afinidad elemental (1.8 / 0.6) |
| `STAB_BONUS` | `game/elements.ts` | Bonus por tipo propio (1.2) |
| `GROWTH` | `game/stats.ts` | Curvas de crecimiento por estadística |
| `ENCOUNTER_TABLES` | `game/species.ts` | Especies por banda de nivel |
| `TEMPLATES` | `game/trainers.ts` | Equipos rivales y jefes |
| `ZONES` | `game/zones.ts` | Zonas, rangos, bonus y guardián |
| `ITEMS` | `game/items.ts` | Precios y topes por combate |
| `GLOBAL_LIMIT` | `services/rateLimit.ts` | Máx. comandos por minuto |
| `maxEnergyForLevel` | `game/stats.ts` | Energía máxima por combate |

---

## Estado actual y siguientes pasos

**Ya funciona:**

- **Digivice** navegable con marco ASCII, ficha *Setup* y panel de análisis
  que dice cuánto pega cada movimiento contra cada rival.
- **Party** con límite configurable, **PC** con tope, y **líder** automático
  (si lo mandas al PC, otro assume).
- **Combate de dos capas** (atributo RPS + afinidad elemental por Digimon).
- **Entrenadores NPC** con 2-4 Digimon que cambian en caliente, y **jefes**
  que no se pueden esquivar y pagan ×3.5 a ×6.
- **5 zonas** con su propio bestiario, rivales y guardián.
- **Economía:** tienda con 6 objetos; los que usas en combate salen del
  inventario real, así que comprar importa.
- **Rate limiting** por comando y global, para que un spam no agote los
  collectors de Discord.
- **Evoluciones automáticas** (6 cadenas completas hasta Mega; 3 cambian de
  atributo, y son los canónicos).
- **Apodos**, **clasificación global** y bestiario.

**Falta para convertirlo en un MMO de verdad:**

- **PvP** entre jugadores con matchmaking.
- **Crankers y eventos** de contenido programado.
- **Postgres** cuando haya que escalar a varios servidores: hoy todo el acceso
  a datos está en `game/repository.ts`, así que el cambio es acotado.
- **Más objetos** (equipo permanente, Digimon de apoyo) y una sink más hondo
  para los DigiBytes.


---

## La interfaz

Discord no es un bot al que le escribes comandos: es un juego con botones.
Escribe `/digivice` y navega. Los comandos siguen ahí, pero son atajos.

### Las seis áreas

```
📟 DIGIVICE  (hub)
├── 🐾 Digimon   equipo · PC · ficha · evolución · equipamiento
├── 🌍 Mundo     mapa · zonas · encuentros · viaje
├── ⚔️ Combate   PvE · PvP · mazmorras · incidencias
├── 🏪 Ciudad    tienda · inventario · equipo · forja
├── 👥 Social    perfil · entrenadores · clasificación
└── 📖 Digivice  registro · bestiario · misiones · logros · títulos
```

Cada pantalla tiene cabecera con el contexto, estado del jugador, acciones,
botón de atrás, botón de Digivice, salto a otras áreas y paginación cuando
hace falta. Se puede jugar varios minutos sin escribir un comando.

### Ciclos que se cierran

```
Digivice → Mundo → Zona → Explorar → Combate → Recompensa → Zona
Digivice → Digimon → Evolución → Elegir ruta → Confirmar → Resultado
Digivice → Ciudad → Tienda → Comprar → Inventario → Equipar
Digivice → Combate → Arena → Cola → Rival → Resultado
```

El combate se queda en el **mismo mensaje** que la zona: pulsar "Explorar"
convierte la pantalla de zona en la de combate, no abre un mensaje aparte.

### Cómo se construye

```
src/ui/
  theme.ts      color y emoji de cada área
  session.ts    sesión de navegación POR USUARIO (pila, nonce, caducidad)
  nav.ts        codificación de custom_id
  components.ts cabecera, barra de jugador, navegación, paginación
  screen.ts     contrato: una pantalla es "estado -> vista"
  router.ts     el único punto por el que pasa un clic
  screens/      las 45 pantallas
```

Una pantalla **no contiene lógica de juego**. Si necesita cambiar algo pide
un servicio y se vuelve a pintar:

```
pantalla  ->  services/  ->  game/  ->  repositorio  ->  BD
```

El verificador comprueba esa regla: ninguna pantalla importa la base de
datos ni tira dados.

### Dos jugadores a la vez

Cada usuario tiene su sesión, con su pila y su `nonce`. El nonce va dentro
de todos los `custom_id` y se rota en cada pantalla, así que un mensaje
abierto hace media hora es rechazado en vez de ejecutar. Comprobado en
`check:ui`.

### Verificación

```bash
npm run check:ui          # armazón: sesiones, nonce, custom_id, límites
npm run check:pantallas   # las 45 pantallas, con datos reales
```


---

## Bestiario de referencia

Los datos de especie (`Level`, `Type`, `Attribute`, `Family`, imagen) se
importan de Digimon Fandom durante una etapa de importación, no cada vez
que un jugador abre el Digivice.

### Regenerarlo

```bash
npm run import:dex   # consulta la fuente y escribe src/data/dex.json
npm run check:dex    # valida y reporta la cobertura
```

El JSON va compilado dentro del bot. El juego no hace ninguna petición de
red: si dependiera de que Fandom esté en pie, un rate-limit dejaría el
bestiario vacío.

### Qué hay en cada ficha

```
📖 FICHA DE ESPECIE            (en la pantalla del Digimon)

Level      Rookie
Type       Reptile
Attribute  Vaccine / Virus
Family     Nature Spirits · Virus Busters · Dragon's Roar

En el juego   Atributo Virus · fuego
Fuente        [Agumon](https://digimon.fandom.com/wiki/Agumon)
```

Los datos de la especie van en su propio embed, separados de las
estadísticas, porque **son cosas distintas**: las estadísticas son del
Digimon del jugador y las afinidades son del combate del juego. `Level`,
`Type` y `Family` son de la especie según la fuente, y ahí el juego y el
canon no coinciden.

### El bestiario filtra por familia

Diez familias (Nature Spirits, Virus Busters, Metal Empire, Dragon's Roar,
Wind Guardians...) son el único dato que agrupa cosas del juego, así que
el bestiario tiene un selector de familia además del filtro por zona y el
de "solo los que vi". Las especies sin ver muestran el nivel y el tipo con
el nombre tapado: saber que hay 35 y que llevas 12 es el primer motivo para
explorar.

### Divergencias aceptadas

El juego no es el canon y no por error. Hay 118 diferencias revisadas y
aceptadas, cada una con su motivo en `src/data/dex-accepted.json`.
`check:dex` solo falla con lo **nuevo**.

```
Level      34/34
Type       34/34
Attribute  33/34   ← Diaboromon: la wiki pone Unidentified, fuera de su taxonomía
Family     34/34
Image      34/34
```

### Las imágenes

No se generan y no se descargan. Casi todo el infobox de Fandom es
material de uso justo: enlazable, no redistribuible. Se guarda la
referencia y la interfaz ofrece un botón a la ficha y otro a la imagen.

Además Discord no pinta imágenes externas dentro de un embed — para verlo
habría que subir el fichero como adjunto. El hueco para material propio
con licencia está preparado en `imagenLocal()`.
