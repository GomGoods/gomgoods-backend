import {
  HttpStatus,
  type INestApplication,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ApiException } from '../common/exceptions/api.exception.js';
import type { ErrorDetail } from '../common/exceptions/api.exception.js';

function validationDetails(errors: ValidationError[]): ErrorDetail[] {
  return errors.flatMap((error) => [
    {
      field: error.property,
      errors: Object.values(error.constraints ?? {}),
    },
    ...validationDetails(error.children ?? []),
  ]);
}

export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ORIGINS'),
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ApiException(
          'VALIDATION_FAILED',
          'Request validation failed',
          HttpStatus.UNPROCESSABLE_ENTITY,
          validationDetails(errors),
        ),
    }),
  );
  app.enableShutdownHooks();

  if (config.getOrThrow<boolean>('SWAGGER_ENABLED')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('GomGoods API')
      .setDescription('GomGoods C2C marketplace backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }
}
