HIDE & SHOOT — SAME WI-FI MULTIPLAYER SETUP

IMPORTANT
A browser-only HTML game cannot accept incoming connections by itself. One computer must run the included Node.js relay server. Every device must be connected to the same Wi-Fi network.

1. Install Node.js on the computer that will host the match (nodejs.org).
2. Open this project folder in VS Code.
3. Open Terminal > New Terminal.
4. Run: npm install
5. Run: npm start
6. Keep the terminal open. It prints the host computer's Wi-Fi IPv4 address, for example http://192.168.1.10:3000.
7. On the host computer, open the printed HTTP address. Choose LAN MULTIPLAYER, select team size, enter a room name, and click HOST / CONNECT.
8. On each other device connected to the same Wi-Fi, open that same HTTP address in its browser. Choose LAN MULTIPLAYER, select the same team size/mode/map/time and room name, then click JOIN ROOM. The host address should fill in automatically.
9. Wait for the roster to show connected players, then click START GAME.

If Windows Firewall asks, allow Node.js on Private networks. Do not expose port 3000 to the public internet. The relay is designed for local Wi-Fi play.

TEAM SIZES
Single Player: local game versus AI bots.
1v1, 2v2, 3v3, 4v4, 5v5: LAN rooms support up to 2, 4, 6, 8, or 10 real players respectively. Choose 1v1 to play with just two devices. Connect all human players before starting. Multiplayer rooms currently require real devices for each player slot; they do not fill empty slots with AI bots. All devices must use the same team size, game mode, map, and time setting.

TROUBLESHOOTING
- Make sure all devices use the same Wi-Fi (not mobile data/guest Wi-Fi isolation).
- Use the HTTP address printed in the server terminal on other devices, not localhost.
- Keep server terminal running.
- If the connection fails, allow Node.js through Windows Firewall on Private networks.
- Start all clients with the same room name and team size.
