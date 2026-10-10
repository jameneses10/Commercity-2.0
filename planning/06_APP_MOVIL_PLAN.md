# 06 - Plan App Móvil CommerCity

## 1. Stack definido

- React Native.
- Expo.
- JavaScript.
- Consumo de API REST.
- AsyncStorage para token y carrito.
- Navegación con React Navigation cuando se implemente.

## 2. Objetivo de la app móvil

Permitir a compradores navegar, comprar, pagar en sandbox, rastrear envíos y calificar productos desde dispositivos Android. También puede incluir funciones esenciales del vendedor en fases posteriores.

## 3. Estructura recomendada

```text
mobile-app/
├── App.js
├── app.json
├── package.json
├── src/
│   ├── navigation/
│   │   ├── AppNavigator.js
│   │   ├── AuthNavigator.js
│   │   └── RoleNavigator.js
│   ├── screens/
│   │   ├── auth/
│   │   ├── buyer/
│   │   ├── seller/
│   │   └── shared/
│   ├── components/
│   │   ├── ProductCard.js
│   │   ├── Button.js
│   │   ├── Input.js
│   │   ├── EmptyState.js
│   │   └── Badge.js
│   ├── services/
│   │   ├── apiClient.js
│   │   ├── authService.js
│   │   ├── productService.js
│   │   ├── cartService.js
│   │   └── orderService.js
│   ├── storage/
│   │   ├── sessionStorage.js
│   │   └── cartStorage.js
│   ├── theme/
│   │   ├── colors.js
│   │   ├── spacing.js
│   │   └── typography.js
│   └── utils/
└── README.md
```

## 4. Navegación recomendada

### Stack público

- Splash.
- Login.
- Registro.
- Catálogo público.
- Detalle producto.

### Stack comprador

- Home comprador.
- Catálogo.
- Detalle producto.
- Carrito.
- Checkout.
- Mis pedidos.
- Detalle pedido.
- Mis envíos.
- Reseñas.
- Perfil.

### Stack vendedor

- Home vendedor.
- Crear tienda si no existe.
- Mi tienda.
- Mis productos.
- Crear/editar producto.
- Pedidos de mi tienda.
- Envíos pendientes.
- Reporte básico.

### Stack administrador

Para primera versión móvil puede no ser prioritario. El panel administrador puede quedar inicialmente en web.

## 5. Pantallas prioritarias MVP móvil

1. Login.
2. Registro.
3. Catálogo.
4. Detalle de producto.
5. Carrito.
6. Checkout sandbox.
7. Mis pedidos.
8. Rastreo de envíos.
9. Crear reseña.

## 6. Manejo de sesión

- Guardar JWT en AsyncStorage.
- Adjuntar token en headers.
- Si API devuelve 401, limpiar sesión.
- Redirigir al login.
- Usar rol para decidir navegación.

## 7. Carrito móvil

- Guardar carrito en AsyncStorage.
- Mantener estructura similar a la web.
- Validar carrito en backend antes de crear pedido.
- Mostrar cambios de precio, stock o disponibilidad.

## 8. Diseño móvil

Debe respetar la guía visual:

- Naranja principal `#fa8000`.
- Azul secundario `#2276ff`.
- Fondo general claro `#f4f7fa`.
- Tarjetas blancas.
- Bordes redondeados.
- Sombras suaves.
- Tipografía limpia.
- La versión móvil deberá conservar la misma jerarquía de color de la web:
  naranja para acciones primarias y azul como color secundario/acento.
- El tema móvil deberá contemplar equivalente claro y oscuro de la identidad web.
- Las tarjetas deberán mantener bordes redondeados y sombras suaves coherentes
  con el sistema visual vigente de CommerCity.

## 9. Componentes móviles reutilizables

- ProductCard.
- StoreHeader.
- PrimaryButton.
- CommercialButton.
- SecondaryButton.
- TextInput.
- Badge.
- RatingStars.
- EmptyState.
- LoadingScreen.
- ErrorMessage.

## 10. Consideraciones técnicas Expo

- Usar variables de entorno o configuración segura para base URL de API.
- Durante desarrollo local, probar con IP accesible desde dispositivo.
- No usar `localhost` desde celular físico para backend remoto/local.
- Mantener servicios API separados de pantallas.
- Reutilizar reglas de validación visual, pero la validación final siempre debe ser backend.

## 11. Criterios de aceptación móvil

- App inicia correctamente en Expo.
- Usuario puede registrarse e iniciar sesión.
- Token se conserva entre sesiones.
- Catálogo consume API real.
- Carrito persiste localmente.
- Checkout valida carrito antes de pagar.
- Mis pedidos muestra información del backend.
- Envíos se muestran separados por tienda.
- Diseño coherente con web y logo.
