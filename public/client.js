// Côté navigateur : se connecte au serveur et affiche l'état de la connexion.
const socket = io();
const status = document.getElementById('status');

socket.on('connect', () => { status.textContent = 'Connecté !'; });
socket.on('disconnect', () => { status.textContent = 'Déconnecté du serveur'; });
