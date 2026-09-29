import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { MenuService } from './menu.service';
import { ModifiersService } from './modifiers.service';
import { ProductsService } from './products.service';

@Module({
  controllers: [CatalogController],
  providers: [CategoriesService, ProductsService, ModifiersService, MenuService],
  exports: [CategoriesService, ProductsService, ModifiersService, MenuService],
})
export class CatalogModule {}
