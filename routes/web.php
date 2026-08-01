<?php

use App\Http\Controllers\AdminUserController;
use App\Http\Controllers\AgendaAvailabilityController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BookingController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\ReservationController;
use App\Http\Controllers\WebhookController;
use Illuminate\Support\Facades\Route;

Route::redirect('/', '/dashboard');

Route::middleware('guest')->group(function () {
    Route::get('/login', [AuthController::class, 'showLogin'])->name('login');
    Route::post('/login', [AuthController::class, 'login']);
});

Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth')->name('logout');

Route::middleware('auth')->group(function () {
    Route::get('/dashboard', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('/dashboard/status', [DashboardController::class, 'status'])->name('dashboard.status');
    Route::get('/agenda/availability', AgendaAvailabilityController::class)->name('agenda.availability');

    Route::post('/bookings/{booking}/toggle-paid', [BookingController::class, 'togglePaid'])->name('bookings.togglePaid');
    Route::post('/bookings/{booking}/check-in', [BookingController::class, 'checkIn'])->name('bookings.checkIn');
    Route::post('/bookings/{booking}/start-session', [BookingController::class, 'startSession'])->name('bookings.startSession');
    Route::post('/bookings/{booking}/no-show', [BookingController::class, 'markNoShow'])->name('bookings.noShow');
    Route::get('/history/today', [BookingController::class, 'historyToday'])->name('history.today');
    Route::get('/history/daily', [BookingController::class, 'historyDaily'])->name('history.daily');
    Route::post('/bookings', [BookingController::class, 'store'])->name('bookings.store');
    Route::post('/bookings/{booking}/checkout', [BookingController::class, 'checkout'])->name('bookings.checkout');
    Route::post('/bookings/{booking}/delay', [BookingController::class, 'delay'])->name('bookings.delay');
    Route::post('/bookings/{booking}/update', [BookingController::class, 'update'])->name('bookings.update');
    Route::post('/bookings/{booking}/extend', [BookingController::class, 'extend'])->name('bookings.extend');
    Route::post('/bookings/{booking}/switch-room', [BookingController::class, 'switchRoom'])->name('bookings.switchRoom');
    Route::post('/bookings/{booking}/cancel', [BookingController::class, 'cancel'])->name('bookings.cancel');

    Route::post('/reservations/{reservation}/update', [ReservationController::class, 'update'])->name('reservations.update');
    Route::post('/reservations/{reservation}/switch-room', [ReservationController::class, 'switchRoom'])->name('reservations.switchRoom');
    Route::post('/reservations/{reservation}/cancel', [ReservationController::class, 'cancel'])->name('reservations.cancel');
    Route::post('/reservations/{reservation}/start-session', [ReservationController::class, 'startSession'])->name('reservations.startSession');
    Route::post('/reservations/{reservation}/no-show', [ReservationController::class, 'markNoShow'])->name('reservations.noShow');

    Route::middleware('admin')->prefix('admin')->name('admin.')->group(function () {
        Route::get('/users', [AdminUserController::class, 'index'])->name('users.index');
        Route::post('/users', [AdminUserController::class, 'store'])->name('users.store');
        Route::put('/users/{user}', [AdminUserController::class, 'update'])->name('users.update');
        Route::delete('/users/{user}', [AdminUserController::class, 'destroy'])->name('users.destroy');
    });
});

Route::post('/webhooks/calendly', [WebhookController::class, 'handleCalendly']);
