<!DOCTYPE html>
<html lang="{{ str_replace('_', '-', app()->getLocale()) }}">
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title inertia>{{ config('app.name', 'WAW Karaoke') }}</title>
        <link rel="icon" href="/waw-favicon.png" type="image/png">
        <link rel="icon" href="/favicon.svg" type="image/svg+xml">
        <link rel="apple-touch-icon" href="/waw-favicon.png">
        <link rel="shortcut icon" href="/waw-favicon.png">

        <!-- FIXED: Added the React Refresh preamble required by Vite -->
        @viteReactRefresh
        
        @vite(['resources/css/app.css', 'resources/js/app.jsx'])
        @inertiaHead
    </head>
    <body class="antialiased bg-slate-950 text-slate-100">
        @inertia
    </body>
</html>