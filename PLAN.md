# Plan de mejoras — Hoja de ruta MMO

> **Estado:** A–E **completados y verificados**. F (Gremios) pendiente.
> Pendiente: F (Gremios). El plan está completo salvo esa pieza.

El orden importa. El equipo cambia **cómo se calculan las estadísticas**, y el
motor de combate depende de eso; los seis sistemas tocan el motor. Si se
parchea cada uno por separado, el quinto rompe lo que hizo el primero.

```
  A) Aislamiento + Equipo      ← HECHO
        ↓
  B) PvP                        ← HECHO
        ↓
  C) Árbol evolutivo            ← HECHO
        ↓
  D) Mazdorras y jefes              ← HECHO
        ↓
  E) Misiones y logros            ← HECHO
        ↓
  F) Gremios
```

---

## A) Aislamiento de combate y equipo permanente

### A1. Aislamiento de estado (el "Importante" del punto 1)

Hoy `BattleState` muta `OwnedDigimon` en algunos caminos y un `restTeam` al
final. Para PvP eso es inaceptable: una desconexión no puede regalar EXP ni
curar el equipo.

**Decisión:** una batalla trabaja sobre un **snapshot**, nunca sobre la entidad.
`OwnedDigimon` es solo datos; el combate muta objetos `Fighter` derivados. El
único punto que toca la base de datos es un **commit explícito** al final, y
solo en PvE. En PvP no hay commit: se registra el resultado y ya.

### A2. Equipo permanente

Regla dura del diseño: **el equipo nunca sobrescribe las estadísticas base**.
Solo suma sobre ellas, en una función aparte. Así equipsar/desequipsar/mejorar
no puede corromper el progreso de un Digimon.

- 4 ranuras: arma, armadura, chip, accesorio.
- 4 rarezas, 5 niveles de mejora (+0 a +5), cada mejora suma +12% del bonus.
- Bonificación de PV/ATQ/DEF/VEL + crítico y precisión.
- **Efectos activos** que se ejecutan en el motor (drenar, primera sangre,
  escudo, contraataque) — son los que dan identidad a una build.
- `/equipo ver|usar|quitar|mejorar`, `/tienda` los vende.

### Por qué va primero
PvP necesita un "poder" que incluya el equipo, el matchmaking lo compara, y sin
A2 el matchmaking no tiene nada que mirar. Y las mazmorras necesitan efectos
activos en el motor.

---

## B) PvP con matchmaking

- `/pvp buscar` entra en cola, `/pvp cancelar` sale.
- Emparejamiento por **poder**, no por nivel: nivel + tier de especie + equipo +
  cobertura de atributos. Dos personas de nivel 40 pero con equipo muy distinto
  no deberíanцер.
- Equipos de hasta **3 Digimon**, al mejor de 3 rondas.
- **Anti-abuso**, que es donde estos sistemas se rompen siempre:
  - desconexión = derrota, no empate ni victoria;
  - enfriamiento anti-revancha (no puedes volver a desafiar al mismo rival
    en 30 min);
  - un username no puede tener dos partidas a la vez;
  - sin emparejamientos con uno mismo ni con cuentas alternativas del mismo
    Trainer ID.
- Puntos por resultado, **recompensa diaria** con racha y **temporada** con
  reinicio parcial.

---

## C) Árbol evolutivo

Punto clave del diseño: **evolucionar debe ser una decisión, no una Godfrey**.
Hoy la evolución es automática al subir de nivel, lo que quita toda la
estrategia. Este paso la convierte en manual y con ramas.

- `/evolucion` muestra el árbol, con lo que falta para cada rama.
- Requisitos: nivel, victorias, objetos y DigiBytes.
- **Ramas alternativas** para un mismo Digimon (elegir una cierra la otra).
- Regresión / rutas alternativas con objetos especiales.
- Las evoluciones descubtas se registran en el Digivice.
- Desbloquear una forma da bonificador permanente de rama, así que no se
  pierde el contenido por no haber ilegal.

---

## D) Mazdorras y jefes globales

- Mazmorras con salas encadenadas; el estado de progreso se guarda al acabar
  una sala, no al empezar.
- Jefes con **fases y habilidades propias** (no "el mismo con más PV"):
  jefe de zona con 3 fases y cambio de atributos entre fases.
- Recompensa por **contribución**: lo que cada uno quitó de la vida del jefe,
  no solo por haber participado.
- Energía diaria e intentos limitados, para que no se abuse.
- Materiales de fabricación que alimentan el equipo de A2.

---

## E) Misiones y logros

Conecta todo lo anterior y da un motivo diario para volver.

- Misiones diarias y semanales con **id único** y registro de reclamadas.
  Nada de farmear la misma misión infinitamente.
- Logros por capturas, victorias, exploración, evoluciones y jefes.
- Recompensas únicas por hito (equipo exclusivo, título, apodo).
- Temporada con reinicio parcial de puntos PvP.
- Estadísticas históricas de por vida.

---

## F) Gremios

- Crear, invitar, unirse, salir, rango con permisos.
- Almacén compartido: **todo movimiento pasa por una transacción** y deja
  rastro en un log. Es el sistema con más riesgo de abuso económico, así que
  el log y los límites van desde la primera versión, no como parche.
- Nivel de gremio y misiones colectivas semanales.
- Clasificación de gremios.

---

## Decisiones ya tomadas que conviene no re-litigar

1. **El equipo suma, nunca sobrescribe.** Las estadísticas derivadas viven en
   `effectiveStats()`.
2. **El combate muta snapshots.** El commit es explícito y solo en PvE.
3. **La evolución pasa a ser manual** con ramas. HECHO. Y con un añadido que
   no estaba en el plan original: **regresión**. Sin ella, elegir rama es una
   apuesta irreversible con la temporada y la gente simplemente no evoluciona.
4. **Rate limit antes que contenido.** Ya está hecho; sin él, cualquier
   sistema nuevo es un vector de abuso.


---

## GUI) Interfaz navegable

> **HECHO.** Ver `npm run check:ui` y `npm run check:pantallas`.

### El problema que resolvia

La estructura anterior era un bot de comandos: `/digivice` abria un embed,
sus botones vivian en un `if` por prefijo en `index.ts` (`dv:`, `zona:`,
`mis:`), cada comando llevaba sus propios manejadores y el Digivice usaba
un collector de dos minutos. De ahí no se podía volver a un sitio anterior,
ni volver al inicio, ni seguir jugando sin escribir.

### Lo que hay

- **45 pantallas** en `src/ui/screens/`, todas con vuelta atrás y vuelta al
  Digivice.
- **Seis áreas**: Digimon, Mundo, Combate, Ciudad, Social y el propio Digivice.
- **Ciclos cerrados**: el combate arranca desde la zona y se queda en el
  MISMO mensaje; la evolución va a elegir ruta, confirmar, ejecutar y
  mostrar el resultado.
- Los comandos siguen existiendo y abren la misma pantalla, así que no
  pueden divergir del camino normal.

### Aislamiento por usuario

Las sesiones se indexan por `userId` y cada una lleva un `nonce` dentro de
todos sus `custom_id`. El router rota el nonce en cada render, de modo que
un mensaje de hace media hora trae un nonce que ya no cuadra y se rechaza
en vez de ejecutar con datos rancios.

### La GUI no tiene logica

    src/ui/screens/  ->  src/services/  ->  src/game/  ->  repositorio  ->  BD

Una pantalla es una funcion pura de "estado -> vista". Si necesita alterar
algo, pide un servicio y se vuelve a pintar. El verificador comprueba que
ninguna pantalla importa la base de datos ni tira dados.

### Lo que hubo que arreglar por el camino

1. **`custom_id` ambiguo.** El mapa de abreviaturas (`zone -> z`) hacia que
   `z` se decodificara como `zone`, y las pantallas que usaban `z=` leían
   `params.z` de una fila que se llamaba `zone`. Cuatro caracteres ahorrados no
   justifican un nombre que se puede confundir.
2. **Recorte que no recortaba.** El recorte de los 100 caracteres de Discord
   acortaba el nonce, no los parámetros, y un `custom_id` de 529 se pasaba
   entero. Ahora descarta parámetros en vez de truncarlos: una especie cortada
   a la mitad no es "la primera que empiece por agum", es un id inexistente.
3. **Seis filas de botones en el mapa.** Discord admite cinco y rechaza el
   mensaje ENTERO cuando se pasa: no salia ni el mapa ni la navegacion.
4. **Bestiario inexistente.** La zona decia "12 Digimon" sin poder decir
   "te faltan 5", porque no habia nada que registrara lo visto. Se anadio
   `species_dex`.


---

## H) Bestiario de referencia (importador de datos)

> **HECHO.** Ver `npm run check:dex`.

### La idea

El catálogo del juego estaba escrito a mano: 35 especies con atributos,
elementos, estadísticas y rutas. Faltaban los datos de referencia que pide
cualquiera que abra una ficha (`Level`, `Type`, `Family`) y faltaban las
imágenes.

La fuente es la API de MediaWiki de Digimon Fandom, no un scrape del HTML:
el infobox tiene parámetros con nombre y eso se lee de forma fiable.

```
FUENTES WEB  ->  IMPORTADOR  ->  src/data/dex.json  ->  CATALOGO  ->  GUI
               (herramienta)     (compilado)          (runtime)
```

El bot NUNCA hace fetch. Si el Digivice dependiera de que Fandom esté
disponible cada vez que alguien abre una pantalla, un rate-limit dejaría el
bestiario vacío entero.

### Tres cosas que NO se hicieron

1. **Sobrescribir `elements` con el `Type` de la wiki.** Son taxonomías
   distintas: la wiki clasifica por biología (Reptile, Bird, Demon, Angel —
   24 tipos) y el juego por elemento de combate (fuego, hielo, viento — 11
   elementos). El `Type` se guarda aparte y se reporta la divergencia.
2. **Elegir un atributo cuando la wiki da dos.** 12 de 34 especies tienen
   `attribute` y `attribute2`. El triángulo del juego es de uno solo; se
   guardan los dos y se reporta el segundo.
3. **Descargar imágenes.** Casi todo el infobox de Fandom es material de uso
   justo: enlazable y citable, no redistribuible. Se guarda la REFERENCIA
   (URL, miniatura, fuente, licencia) y la interfaz enlaza.

### El baseline de divergencias

El juego NO es el canon, y no por descuido. Agumon es `virus` aquí y
`Vaccine` en la wiki; hay 17 atributos y 12 niveles que difieren, más un
tier `novato` que el canon no tiene.

Un `check:dex` que falla 30 veces en cada importación no informa de nada:
el día que aparezca una diferencia de verdad, con treinta avisos de fondo
nadie la ve. Así que las divergencias se aceptan una vez con su motivo
(`src/data/dex-accepted.json`) y el informe solo señala las NUEVAS.

### Lo que el importador no se inventa

- `Veldmon` no tiene página en la wiki con ningún nombre cercano
  (`Veldirimon`, `Velimon`, `Vermilimon`, `Vademon`: ninguna). Se deja el
  hueco y se reporta. Adivinar un mapeo metería datos de otra especie.
- `Valemon` tampoco existe en el canon. Está mapeado a `Veemon` como
  hipótesis, marcada "REVISAR" en el informe.
- `Diaboromon` trae `|attribute=Unidentified`, que no es uno de los siete
  valores de la propia wiki. Se guarda el texto crudo y el campo queda
  vacío, en vez de convertirlo a algo.
- `Paulmon` es `Palmon` en el canon (grafía del doblaje).
- `MetalGreymon` y `Cherubimon` son páginas de desambiguación: se elige la
  variante canónica.
