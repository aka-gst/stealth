# ПЕРИМЕТР — задание на звук

Задание самодостаточное. Промты по-английски — генераторы точнее понимают
английские жанровые термины; пояснения и правила по-русски. У музыки два вида
промта: **строка стиля** для Suno и **развёрнутое описание** для ElevenLabs
Music или Stable Audio. Брать один из двух.

## Что за игра

Браузерный стелс сверху вниз в духе старых MGS. Игрок пробирается мимо стражей
с конусами зрения, у него три укрытия — **от взгляда, от слуха и в темноте**, —
и уровень проходится четырьмя разными способами. Нелетальный проход возможен
с самого начала.

Вид — как в Metal Gear на NES: светло и контрастно, тьма только на отдельных
уровнях. Всё рисуется фигурами.

## Почему здесь звук — не украшение

**Слух в этой игре — половина механики.** Шум, который слышат стражи, и звук,
который слышит игрок, — разные вещи: крадущийся шаг для стражей ровно ноль, но
игрок его слышит, иначе не понимает, что вообще идёт.

Отсюда главное требование ко всем шагам: **поверхность должна узнаваться на
слух, не глядя под ноги**. Игрок должен услышать, что вышел на гравий, и
успеть отступить. Четыре поверхности с их множителями шума:

| Поверхность | Множитель | Как звучит сейчас |
|---|---|---|
| бетон | 1 | ровный сухой шаг |
| гравий | 1,8 | крошка, самый громкий |
| снег | 0,3 | мягкий скрип |
| трава | 0,25 | шелест, почти беззвучно |

Пять режимов движения различаются громкостью: бег 0,55 · шаг 0,38 · крадучись
0,15 · ползком 0,10 · вплотную к стене 0,13.

Отдельно: **у стражей есть имена и болтовня на маршруте**, потому что финал
игры про то, кто не вышел утром на смену, — человека надо встретить живым.

## Правила выдачи

- **Музыка:** MP3, 128–160 kbps, 60–120 секунд, бесшовная петля по такту.
  Без вокала.
- **Звуки:** WAV 44.1 кГц, короткие, без хвоста тишины, пик −3 дБ.
- **Шаги — комплектами.** На каждую поверхность нужно **4–6 вариантов** одного
  шага, слегка разных. Один файл, повторяемый десять раз в секунду, слышен как
  пулемёт и убивает всё ощущение крадущегося хода.
- **Тихое должно оставаться тихим.** Шаг по траве не нормализовать до общего
  уровня: его тихость — часть механики.
- **Вес:** файлы уезжают на публичный сайт (`aka-gst.ru/stealth/`).
- Один промт — один файл.

---

# Музыка

## 1. `music/patrol.mp3` — спокойное движение

Играет, пока игрока не заметили. Задача трека — **дать слушать**. Всё, что
занимает середину частот, мешает игроку разбирать шаги и голоса, поэтому здесь
почти нет инструментов: низ, воздух и редкие точки.

Строка стиля для Suno:

```
minimal dark ambient, 70 BPM, sparse sub bass pulse, distant metallic taps,
cold air texture, no melody, no vocals, loopable, patient, tense
```

Развёрнутое описание:

```
A minimal, patient dark ambient loop for a stealth game. 70 BPM, no melody
and no chord progression. A slow sub-bass pulse, cold air texture, and rare
distant metallic taps with long silences between them. The mid frequencies
must stay almost empty, because the player needs to hear footsteps and voices
over it. Tense but calm — this plays while nothing is happening. No vocals,
no build-up. Seamless loop, 90 seconds.
```

## 2. `music/alert.mp3` — тревога

Включается на «!» и держится, пока идёт поиск. Ворота при тревоге заперты, и
игрок пережидает — значит, трек играет минуту-две подряд и не должен изматывать.

```
urgent stealth alert loop, 120 BPM, driving low pulse, dry percussive ticks,
rising tension without melody, no vocals, loopable, relentless
```

Развёрнутое описание:

```
An urgent alert loop for a stealth game, playing while guards search. 120 BPM,
a driving low pulse with dry percussive ticks on top and a slowly rising
tension layer. No melody and no vocals. It must feel like pressure rather
than action music, and must stay listenable for two minutes straight without
becoming exhausting. Seamless loop, 60 seconds.
```

## 3. `music/finale.mp3` — утренняя перекличка

Играет на финальном экране, где игра называет имена тех, кто не вышел на смену.
Здесь единственный раз в игре разрешена мелодия — и она не должна судить.

```
quiet sombre piano and strings, 60 BPM, minor key, sparse and restrained,
no vocals, reflective, not tragic
```

Развёрнутое описание:

```
A quiet, restrained instrumental for the ending screen of a stealth game,
where the names of people who did not report for duty are read out. Sparse
piano with a thin string pad underneath, minor key, around 60 BPM. Reflective
and plain — it must not sound accusing, triumphant, or melodramatic. No
vocals. 60 seconds, no loop needed.
```

---

# Звуки

Сейчас всё синтезируется в `src/audio.js` (177 строк) и работает. Файлы нужны
там, где синтез не даёт узнаваемости: поверхности и живые голоса.

## Шаги — по 4–6 вариантов на каждый файл

`sfx/step-concrete-1..6.wav`

```
Single footstep on bare concrete, 0.12 seconds. A dry flat scuff of a boot
sole, close-miked, no reverb, no echo. Neutral and plain — this is the
baseline surface all others are compared against. Mono.
```

`sfx/step-gravel-1..6.wav` — самая громкая поверхность в игре.

```
Single footstep on loose gravel, 0.2 seconds. Sharp crunching of small stones
with a scattered tail of individual pebbles settling. Noticeably brighter and
busier than a step on concrete — a player must recognise it instantly. Close,
dry, no reverb. Mono.
```

`sfx/step-snow-1..6.wav`

```
Single footstep on packed snow, 0.18 seconds. A soft low creaking compression
with no bright content at all — muffled and dull. Close, dry, no reverb. Mono.
```

`sfx/step-grass-1..6.wav`

```
Single footstep on grass, 0.15 seconds. A very quiet soft rustle of blades,
almost no impact. Must be the quietest of the four surfaces by a clear margin.
Close, dry, no reverb. Mono.
```

`sfx/crawl-1..4.wav` — ползком.

```
Body dragging along the ground while crawling, 0.4 seconds. Cloth sliding on
dirt with a faint scrape. Very quiet, slow, no impact. Mono.
```

## Стражи

`sfx/alert.wav` — тот самый «!». Единственный звук игры, который **обязан**
узнаваться раньше, чем игрок посмотрит на экран. Сейчас синтезируется двумя
нотами вверх и ударом снизу — файл должен сохранить эту форму.

```
Stealth game detection alert, 0.6 seconds. Two sharp ascending electronic
tones followed by a low impact underneath. Instantly recognisable, dry, no
reverb, no melody beyond those three events. It must cut through any music.
Mono.
```

`sfx/suspicion.wav` — страж что-то услышал, но ещё не увидел.

```
Stealth game suspicion cue, 0.5 seconds. A single questioning electronic tone
bending slightly upward and stopping. Softer and clearly less final than a
detection alert. Dry, no reverb. Mono.
```

`sfx/lost.wav` — страж потерял игрока и возвращается на маршрут.

```
Stealth game "lost the target" cue, 0.6 seconds. A soft descending tone
settling and fading. Relief without reward. Dry, no reverb. Mono.
```

`sfx/knock.wav` — стук по стене, единственный звук, который игрок делает
нарочно, чтобы приманить стража.

```
Two knuckle knocks on a metal wall, 0.4 seconds. Hard, dry, with a short
metallic ring. Deliberate and clean — this is a tool, not an accident. Mono.
```

`sfx/takedown.wav` — нелетальный вывод из строя.

```
Non-lethal takedown, 0.6 seconds. Cloth grip, a short choked exhale, then a
soft body settling onto the floor. Quiet and controlled — no impact, no
violence. Mono.
```

`sfx/body-drop.wav`

```
Unconscious body being laid down on concrete, 0.5 seconds. A soft heavy
settle of cloth and mass, no hard impact. Quiet, dry. Mono.
```

## Голоса стражей

Стражи болтают на маршруте и у них есть имена. Голос нужен **русский мужской,
спокойный**, без пафоса и без акцента — обычные люди на скучной работе. Это
единственные вокальные файлы во всём задании.

`voice/idle-1..6.wav` — болтовня на маршруте. Фразы придумать свои, вот
характер:

```
Russian male voice, calm and bored, speaking a short casual line during a
night shift. Flat and unremarkable — an ordinary man doing a dull job, not a
soldier and not a villain. Close, dry, no reverb, no music. 2 seconds.
```

`voice/what-1..3.wav` — услышал шум.

```
Russian male voice, mildly alert, a short questioning line — someone who
heard something and is not yet worried. Calm, not shouting. Close, dry,
no reverb. 1.5 seconds.
```

`voice/spotted-1..3.wav` — увидел.

```
Russian male voice shouting a short alarm line, urgent and loud but not
theatrical. Close, dry, no reverb. 1.5 seconds.
```

## Мир

`sfx/door.wav`

```
Heavy metal door opening on a hinge, 0.9 seconds. A low groan of metal with a
short latch click at the start. Dry, minimal reverb. Mono.
```

`sfx/gate-locked.wav` — ворота заперты, пока идёт тревога. Игрок дёргает и
получает отказ; звук объясняет правило без единого слова текста.

```
Locked metal gate being pulled and refusing to open, 0.5 seconds. A hard
metallic clank stopping dead, with chain rattle. Blunt and final. Mono.
```

`sfx/pickup.wav`

```
Small item being picked up, 0.2 seconds. A short soft cloth-and-metal rustle.
Quiet and neutral. Mono.
```

---

# Что делать с готовыми файлами

1. Музыку положить в `music/`, звуки — в `assets/sfx/`, голоса — в
   `assets/voice/`.
2. `src/audio.js` сейчас только синтезирует. Дописывать его нужно так, чтобы
   **синтез оставался запасным вариантом**: если файл не загрузился, звук
   должен остаться, иначе игрок теряет половину механики из-за сетевой ошибки.
   Образец загрузчика — `~/dev/odin-udar/src/audio.js`.
3. Начинать с шагов: четыре поверхности по четыре варианта — шестнадцать
   файлов, и это уже вся разница между «слышу, где иду» и «не слышу».
4. Голоса стражей — последними: они дороже всего в генерации и меньше всего
   влияют на прохождение, зато сильнее всего на финал.
