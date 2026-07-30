<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureUserIsAdmin
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (!$user || !$user->isAdmin()) {
            if ($request->header('X-Inertia')) {
                return redirect()->route('dashboard');
            }

            abort(403, 'Admin access required.');
        }

        return $next($request);
    }
}
