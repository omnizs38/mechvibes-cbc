![image](https://github.com/user-attachments/assets/2437f93b-30b3-4a07-8527-f1b23dae7fd2)


# MechvibesDX - The next version of Mechvibes


I've been working on **MechvibesDX** - a complete rewrite of Mechvibes with significant improvements to performance, compatibility, and user experience. You can check it out at the new repository: [mechvibes-dx](https://github.com/hainguyents13/mechvibes-dx)

## What's happening

-   **Current repo**: Will become legacy once MechvibesDX is stable
-   **New repo**: [mechvibes-dx](https://github.com/hainguyents13/mechvibes-dx) - active development
-   **Future**: When MechvibesDX reaches v1.0, it will become the main Mechvibes

## Major improvements in MechvibesDX

-   **Performance**: Completely rewritten audio engine for faster soundpack loading
-   **Audio Events**: Support for both keyboard (keydown/keyup) and mouse (button press/release) sounds with extended button support
-   **Size**: Significantly smaller application size with reduced memory footprint
-   **Settings**: Advanced settings page for fine-tuning audio, performance, and behavior options
-   **Compatibility**: Much better support for existing soundpacks from the community
-   **Soundpack Management**: Easy soundpack installation - import via modal or copy to folder and refresh, no app restart required
-   **Customization**: Modern UI design with extensive theming options, custom backgrounds, logo customization
-   **Organization**: Separate keyboard/mouse soundpack folders, better file
-   **Architecture**: Built with Rust and modern web technologies

## Try it out

Head over to [mechvibes-dx](https://github.com/hainguyents13/mechvibes-dx) to:

-   Download the latest build and test new features
-   Migrate your soundpacks easily with the new migration tools
-   Customize the interface with themes, backgrounds, and logo options
-   Report issues or suggest improvements

I'm working towards a stable v1.0 release, and your feedback helps make MechvibesDX better. The migration process for existing soundpacks is much smoother now.

**Check out MechvibesDX**: https://github.com/hainguyents13/mechvibes-dx

_This repository will remain available during the transition period._


---

# Mechvibes: A fun and practical way to bring your favorite keyboard sounds anywhere

## 2.4 beta direction

The 2.4 line modernizes the Electron runtime and global input hook, introduces consent-based stable and beta updates, adds an experimental low-latency Web Audio engine for soundpack v3, and preserves v1/v2 compatibility. It also adds output-device selection, safer soundpack management, dark mode, stronger release gates, and automated Windows release assets.

- Soundpack v3 specification: [docs/soundpack-v3.md](docs/soundpack-v3.md)
- Automated release process: [docs/releases.md](docs/releases.md)
- Windows acceptance matrix: [docs/windows-critical-fixes.md](docs/windows-critical-fixes.md)

> Mechvibes started as a side project I created for myself. Like many mechanical keyboard lovers, I faced challenges when using my keyboard in quiet environments - whether it was late at night or in the office. The loud, satisfying clicks might be music to my ears, but not so much for my parents or coworkers! If you’re in the same boat, Mechvibes is here for you.

![Mechvibes screenshot](https://github.com/user-attachments/assets/f0340d8a-3e47-4117-a110-ce54575fc27c)

## What Can You Do with Mechvibes?
🎨 **Customize Your Sound Experience:** Add new keyboard sound sets by recording any sound you like. Follow a few simple steps, and you’re good to go!

🎵 **Enjoy Your Favorite Keyboard Sounds Anywhere:** Use your laptop keyboard or a non-mechanical keyboard at work, and still enjoy the sounds you love.

🌻 **Get Creative with Sound Packs:** With Mechvibes Editor, you can create brand-new sound packs, edit existing ones, or even share them with your friends.

💪 **Versatile Applications:** Use it for anything you can imagine! Demo keyboard sounds for buyers, customize sounds for specific keys, or make your keyboard experience uniquely yours.

> Mechvibes isn’t just an app, it’s a way to bring the joy of mechanical keyboards to every environment, without compromising on your surroundings.

## How to Get Started
- Download the app from the [Releases page](https://github.com/omnizs38/mechvibes/releases/latest)
- Run it.
- Enjoy!

## Compile from Source

Use Node.js 22.22.0 (see `.nvmrc`) and the committed npm lockfile:

```sh
npm ci
npm run verify
npm start
```

Build an installer for your platform with `npm run build:win`, `npm run build:mac`, or `npm run build:linux`.

Windows stability changes must pass the automated workflow and the [Windows critical-fix verification matrix](docs/windows-critical-fixes.md) before release.

## Have Feedback or Suggestions?
We’d love to hear from you! 🤝 Got an idea or ran into an issue? Feel free to share. It’s always appreciated!

## Powered by an Amazing Community
Mechvibes has grown far beyond its initial scope, thanks to the incredible support and contributions from the community. Many users have created and shared sound packs, offered ideas, and even contributed code to improve the app.
A heartfelt thank you to everyone who has helped Mechvibes evolve - you’ve truly made this project special ❤️

### 🎖️ Contributors:
<a href="https://github.com/hainguyents13/mechvibes/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hainguyents13/mechvibes&anon=1" height="30" />
</a>
