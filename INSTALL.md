# Install Homestead Free Preview

Homestead Free does not require a license code. It includes one owner account,
one active playback stream, and the core Movies, TV, Music, Books, and locally
archived YouTube libraries.

## Windows

Run the Homestead Windows setup package. It is self-contained and does not
require Docker Desktop, Node.js, or FFmpeg to be installed separately. It
installs under `%LOCALAPPDATA%\Homestead Free`, keeps `data` and `media` there,
adds Start/Stop shortcuts, and opens `http://localhost:7312` when ready.

## Docker, Linux, or Unraid

1. Download `docker-compose.yml` into a new folder.
2. Open a terminal in that folder.
3. Run `docker pull ghcr.io/tbritton0826/homestead:latest`.
4. Run `docker compose up -d`.
5. Open `http://YOUR-SERVER-IP:7312` from the same trusted network.
6. Complete owner setup and save the password somewhere safe.

The default package stores persistent state in `./data` and provides an empty
`./media` folder. Edit the volume mappings before adding your media folders.

For example Unraid mappings, edit `docker-compose.media.yml`, then run:

```sh
docker compose -f docker-compose.yml -f docker-compose.media.yml pull
docker compose -f docker-compose.yml -f docker-compose.media.yml up -d
```

The default image is `ghcr.io/tbritton0826/homestead:latest`. Set
`HOMESTEAD_TAG=0.6.8.64` in `.env` to pin this release instead of following
`latest`.

### Build locally from source

The normal install pulls a prebuilt image. Maintainers can still build the
checked-out source with:

```sh
docker compose -f docker-compose.yml -f docker-compose.build.yml build
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d
```

### Unraid Community Apps

Once the listing is accepted, search for **Homestead** on the Unraid Apps tab.
The template exposes the web port, persistent AppData folder, and separate
Movies, TV, Music, Books, and YouTube paths so each share can be reviewed before
installation.

## Safe side-by-side Unraid test

Use a separate folder, data directory, container name, and port:

```sh
HOMESTEAD_PORT=7313 docker compose -p homestead-free-preview -f docker-compose.yml -f docker-compose.media.yml -f docker-compose.side-by-side.yml up -d
```

Open `http://YOUR-SERVER-IP:7313`. Do not reuse the live installation's `data`
folder. The example side-by-side media mounts are read-only.

## Stop or remove the container

Run `docker compose down`. This removes the container but leaves `data` and
`media` in place. Back up `data` before every update.

Do not publish port 7312 directly to the internet. Use Homestead only on a
trusted network unless a supported HTTPS remote-access configuration is in use.
