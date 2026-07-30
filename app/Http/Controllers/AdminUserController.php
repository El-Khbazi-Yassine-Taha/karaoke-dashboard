<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class AdminUserController extends Controller
{
    public function index(): Response
    {
        $users = User::query()
            ->orderByRaw("CASE WHEN role = 'admin' THEN 0 ELSE 1 END")
            ->orderBy('username')
            ->get(['id', 'username', 'name', 'role', 'created_at']);

        return Inertia::render('Admin/Users', [
            'users' => $users,
            'authUserId' => auth()->id(),
        ]);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'username' => ['required', 'string', 'max:255', 'unique:users,username'],
            'password' => ['required', 'string', 'min:4', 'confirmed'],
        ]);

        User::create([
            'name' => $validated['username'],
            'username' => $validated['username'],
            'password' => $validated['password'],
            'role' => 'staff',
        ]);

        return redirect()
            ->route('admin.users.index')
            ->with('success', 'Staff account created.');
    }

    public function update(Request $request, User $user)
    {
        $validated = $request->validate([
            'username' => [
                'required',
                'string',
                'max:255',
                Rule::unique('users', 'username')->ignore($user->id),
            ],
            'password' => ['nullable', 'string', 'min:4', 'confirmed'],
        ]);

        $user->username = $validated['username'];
        $user->name = $validated['username'];

        if (!empty($validated['password'])) {
            $user->password = $validated['password'];
        }

        $user->save();

        return redirect()
            ->route('admin.users.index')
            ->with('success', 'Account updated.');
    }

    public function destroy(Request $request, User $user)
    {
        if ($user->id === $request->user()->id) {
            return back()->withErrors([
                'user' => 'You cannot delete your own account.',
            ]);
        }

        if ($user->isAdmin() && User::where('role', 'admin')->count() <= 1) {
            return back()->withErrors([
                'user' => 'You cannot delete the last admin account.',
            ]);
        }

        $user->delete();

        return redirect()
            ->route('admin.users.index')
            ->with('success', 'Account deleted.');
    }
}
