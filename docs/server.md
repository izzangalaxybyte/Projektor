# Running the server on the Linux box

One container runs the API, the transcoder, and the web app on port 8096. Everything the server owns lives in one data directory; your media is mounted read-only.

## Requirements

- Docker with Compose (`docker compose version` works).
- An Intel CPU with an iGPU for hardware transcoding; `/dev/dri/renderD128` must exist on the host. Without it the server still runs and transcodes on the CPU.
- Media folders on local disk or a mounted share.

## First start

```bash
git clone https://github.com/izzangalaxybyte/Projektor.git
cd Projektor
cp deploy/.env.example deploy/.env
$EDITOR deploy/.env                      # set DATA_DIR and the three media folders
docker compose -f deploy/docker-compose.yml up -d --build
```

The first build downloads the base images and the Intel media drivers and takes a few minutes. Then:

```bash
curl -s http://localhost:8096/api/health
```

`encoder` should read `h264_vaapi`. If it says `libx264`, `encoderReason` tells you why (usually the render node is not passed through, or the iGPU is too old for the iHD driver, in which case set `LIBVA_DRIVER_NAME=i965` in `deploy/.env`).

Open `http://<box-ip>:8096` in a browser, create the admin profile, then in **Settings → Libraries** add `/media/movies`, `/media/tv`, and `/media/anime` (the paths inside the container) and scan. Add a TMDB key under **Settings → Metadata** for posters and descriptions.

## Verifying hardware transcoding

Play something the browser cannot direct-play (an HEVC file in Chrome) and, on the host:

```bash
sudo intel_gpu_top
```

The Video engine should show load while the transcode runs. Inside the container, `docker exec projektor vainfo` lists the codec profiles the driver exposes.

## Updating

```bash
git pull
docker compose -f deploy/docker-compose.yml up -d --build
```

Database migrations run automatically on start. Back up `DATA_DIR` before major upgrades; it holds the database, artwork cache, and subtitle cache, all of which can be rebuilt from your media and TMDB but slowly.

## Logs and troubleshooting

```bash
docker compose -f deploy/docker-compose.yml logs -f
```

Lines are JSON. `scan finished` shows per-library counts; `ffmpeg started` shows the exact command for a playback session; `ffmpeg exited` with a non-zero code carries the last stderr lines.

Playback sessions write segments to `DATA_DIR/transcode/` and clean up after a minute of inactivity. If the box runs out of disk, look there first.
